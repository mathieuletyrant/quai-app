import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { DownloadAttributes, DownloadContentState } from "./Download.ts"

/** Which APNs server reaches this iPhone: builds from Xcode use development, TestFlight production. */
export const ApnsEnvironment = Schema.Literals(["development", "production"]).annotate({ identifier: "ApnsEnvironment" })
export type ApnsEnvironment = typeof ApnsEnvironment.Type

export const DeviceId = Schema.String.pipe(Schema.brand("DeviceId"))
export type DeviceId = typeof DeviceId.Type

/** The iPhone a request comes from, once its bearer token checked out. */
export class CurrentDevice extends Context.Service<CurrentDevice, { readonly id: DeviceId; readonly name: string }>()(
  "quai/CurrentDevice"
) {}

/** Every iPhone route: `Authorization: Bearer <device token>`, the token the pairing returned. */
export class DeviceAuth extends HttpApiMiddleware.Service<DeviceAuth, { provides: CurrentDevice }>()("quai/DeviceAuth", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.bearer }
}) {}

export class InvalidPairingCode extends Schema.TaggedError<InvalidPairingCode>()("InvalidPairingCode", {
  message: Schema.String
}, { httpApiStatus: 403 }) {}

export const PairDevice = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  apnsEnvironment: ApnsEnvironment,
  /** Left out until the iPhone allows Live Activities. */
  pushToStartToken: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "PairDevice" })

export const PairedDevice = Schema.Struct({
  deviceId: DeviceId,
  /** Secret: the app keeps it in the Keychain and sends it as a bearer token. */
  token: Schema.String
}).annotate({ identifier: "PairedDevice" })

export const UpdateDevice = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  pushToStartToken: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "UpdateDevice" })

export const ActivityToken = Schema.Struct({
  mediaKey: Schema.String,
  pushToken: Schema.String
}).annotate({ identifier: "ActivityToken" })

export const RunningActivity = Schema.Struct({
  attributes: DownloadAttributes,
  content: DownloadContentState
}).annotate({ identifier: "RunningActivity" })

/** Routes the iPhone app calls. Reachable without the host's login (see deploy notes). */
export class DevicesGroup extends HttpApiGroup.make("devices")
  .add(HttpApiEndpoint.post("pair", "/devices", { payload: PairDevice, success: PairedDevice, error: InvalidPairingCode }).annotate(OpenApi.Identifier, "pairDevice"))
  .add(
    HttpApiEndpoint.patch("update", "/devices/me", { payload: UpdateDevice }).annotate(OpenApi.Identifier, "updateDevice")
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.post("activityToken", "/devices/me/activity-tokens", { payload: ActivityToken }).annotate(OpenApi.Identifier, "reportActivityToken")
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.get("activities", "/activities", { success: Schema.Array(RunningActivity) }).annotate(OpenApi.Identifier, "listActivities")
      .middleware(DeviceAuth)
  )
  .prefix("/api") {}

export const PairingCode = Schema.Struct({
  code: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
  /** What the QR code holds: `quai://pair?…`, read by the app's scanner. */
  link: Schema.String
}).annotate({ identifier: "PairingCode" })

export const DeviceSummary = Schema.Struct({
  id: DeviceId,
  name: Schema.String,
  apnsEnvironment: ApnsEnvironment,
  canStartActivities: Schema.Boolean,
  pairedAt: Schema.DateTimeUtcFromString,
  lastSeenAt: Schema.optionalKey(Schema.DateTimeUtcFromString)
}).annotate({ identifier: "DeviceSummary" })

/** Routes only the console calls. They stay behind the host's login (Umbrel, Cloudflare Access). */
export class ConsoleGroup extends HttpApiGroup.make("console")
  .add(
    HttpApiEndpoint.post("createPairingCode", "/pairing-codes", {
      payload: Schema.Struct({ serverUrls: Schema.Array(Schema.String) }),
      success: PairingCode
    }).annotate(OpenApi.Identifier, "createPairingCode")
  )
  .add(HttpApiEndpoint.get("devices", "/devices", { success: Schema.Array(DeviceSummary) }).annotate(OpenApi.Identifier, "listDevices"))
  .add(HttpApiEndpoint.delete("removeDevice", "/devices/:id", { params: { id: DeviceId }, error: HttpApiError.NotFound }).annotate(OpenApi.Identifier, "removeDevice"))
  .prefix("/console-api") {}

export const PushSettings = Schema.Struct({
  configured: Schema.Boolean,
  /** Where the key comes from: saved in the console, or the `QUAI_APNS_*` environment variables. */
  source: Schema.optionalKey(Schema.Literals(["console", "environment"])),
  keyId: Schema.optionalKey(Schema.String),
  teamId: Schema.optionalKey(Schema.String),
  /** The iOS app's bundle id the pushes target. */
  topic: Schema.String
}).annotate({ identifier: "PushSettings" })

export const SavePushKey = Schema.Struct({
  /** The .p8 file's text, as Apple gives it. Never sent back. */
  keyPem: Schema.String,
  keyId: Schema.String,
  teamId: Schema.String
}).annotate({ identifier: "SavePushKey" })

export class InvalidPushKey extends Schema.TaggedError<InvalidPushKey>()("InvalidPushKey", {
  message: Schema.String
}, { httpApiStatus: 400 }) {}

/** The Apple push key, set from the console's Settings. */
export class PushGroup extends HttpApiGroup.make("push")
  .add(HttpApiEndpoint.get("pushSettings", "/push-settings", { success: PushSettings }).annotate(OpenApi.Identifier, "getPushSettings"))
  .add(
    HttpApiEndpoint.put("savePushKey", "/push-settings", { payload: SavePushKey, success: PushSettings, error: InvalidPushKey })
      .annotate(OpenApi.Identifier, "savePushKey")
  )
  .add(HttpApiEndpoint.delete("removePushKey", "/push-settings", { success: PushSettings }).annotate(OpenApi.Identifier, "removePushKey"))
  .prefix("/console-api") {}
