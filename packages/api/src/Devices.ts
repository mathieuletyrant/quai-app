import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
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
  .add(HttpApiEndpoint.post("pair", "/devices", { payload: PairDevice, success: PairedDevice, error: InvalidPairingCode }))
  .add(
    HttpApiEndpoint.patch("update", "/devices/me", { payload: UpdateDevice })
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.post("activityToken", "/devices/me/activity-tokens", { payload: ActivityToken })
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.get("activities", "/activities", { success: Schema.Array(RunningActivity) })
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
    })
  )
  .add(HttpApiEndpoint.get("devices", "/devices", { success: Schema.Array(DeviceSummary) }))
  .add(HttpApiEndpoint.delete("removeDevice", "/devices/:id", { params: { id: DeviceId }, error: HttpApiError.NotFound }))
  .prefix("/console-api") {}
