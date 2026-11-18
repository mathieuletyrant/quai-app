import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { ActionType, ActivityAttributes, ActivityContent, ActivityStep, CatalogAction, CatalogEvent, Flow } from "./Activity.ts"

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

/** One flow on one iPhone: on or off, and the steps it hides (never the last). */
export const FlowPreference = Schema.Struct({
  enabled: Schema.Boolean,
  hiddenSteps: Schema.Array(Schema.String)
}).annotate({ identifier: "FlowPreference" })
export type FlowPreference = typeof FlowPreference.Type

/** What this iPhone wants to receive, per flow id. A flow left out: on, every step. */
export const DevicePreferences = Schema.Struct({
  flows: Schema.Record(Schema.String, FlowPreference)
}).annotate({ identifier: "DevicePreferences" })
export type DevicePreferences = typeof DevicePreferences.Type

/** A flow as the iPhone lists it in its settings. */
export const FlowSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  color: Schema.String,
  icon: Schema.String,
  steps: Schema.Array(ActivityStep)
}).annotate({ identifier: "FlowSummary" })

/** A button pressed on a Live Activity. */
export const ActivityAction = Schema.Struct({
  /** `attributes.key` of the activity. */
  key: Schema.String,
  action: ActionType
}).annotate({ identifier: "ActivityAction" })

export class InvalidAction extends Schema.TaggedError<InvalidAction>()("InvalidAction", {
  message: Schema.String
}, { httpApiStatus: 400 }) {}

export const TestActivity = Schema.Struct({ flowId: Schema.String }).annotate({ identifier: "TestActivity" })

export const RunningActivity = Schema.Struct({
  attributes: ActivityAttributes,
  content: ActivityContent
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
    HttpApiEndpoint.get("preferences", "/devices/me/preferences", { success: DevicePreferences })
      .annotate(OpenApi.Identifier, "getPreferences")
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.put("savePreferences", "/devices/me/preferences", { payload: DevicePreferences, success: DevicePreferences })
      .annotate(OpenApi.Identifier, "savePreferences")
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.post("testActivity", "/devices/me/test-activity", { payload: TestActivity, error: HttpApiError.NotFound })
      .annotate(OpenApi.Identifier, "sendTestActivity")
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.get("flows", "/flows", { success: Schema.Array(FlowSummary) })
      .annotate(OpenApi.Identifier, "listFlows")
      .middleware(DeviceAuth)
  )
  .add(
    HttpApiEndpoint.post("action", "/activities/actions", { payload: ActivityAction, error: [InvalidAction, HttpApiError.NotFound] })
      .annotate(OpenApi.Identifier, "performAction")
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


export class InvalidFlow extends Schema.TaggedError<InvalidFlow>()("InvalidFlow", {
  message: Schema.String
}, { httpApiStatus: 400 }) {}

/** Flows, from the console's Flows page. */
export class FlowsGroup extends HttpApiGroup.make("flows")
  .add(HttpApiEndpoint.get("list", "/flows", { success: Schema.Array(Flow) }).annotate(OpenApi.Identifier, "listAllFlows"))
  .add(HttpApiEndpoint.get("catalog", "/flows/catalog", { success: Schema.Array(CatalogEvent) }).annotate(OpenApi.Identifier, "getCatalog"))
  .add(
    HttpApiEndpoint.get("actions", "/flows/actions", { success: Schema.Array(CatalogAction) })
      .annotate(OpenApi.Identifier, "getActionCatalog")
  )
  .add(
    HttpApiEndpoint.put("save", "/flows/:id", { params: { id: Schema.String }, payload: Flow, success: Flow, error: InvalidFlow })
      .annotate(OpenApi.Identifier, "saveFlow")
  )
  .add(
    HttpApiEndpoint.delete("remove", "/flows/:id", { params: { id: Schema.String }, error: [InvalidFlow, HttpApiError.NotFound] })
      .annotate(OpenApi.Identifier, "removeFlow")
  )
  .add(
    HttpApiEndpoint.post("reset", "/flows/:id/reset", { params: { id: Schema.String }, success: Flow, error: HttpApiError.NotFound })
      .annotate(OpenApi.Identifier, "resetFlow")
  )
  .add(
    HttpApiEndpoint.post("test", "/flows/:id/test", { params: { id: Schema.String }, error: HttpApiError.NotFound })
      .annotate(OpenApi.Identifier, "testFlow")
  )
  .prefix("/console-api") {}
