import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { ActionType, ActivityAttributes, AlertKind, ActivityContent, ActivityStep, CatalogAction, CatalogEvent, Flow, FlowSubject } from "./Activity.ts"

/** Which APNs server reaches this iPhone: builds from Xcode use development, TestFlight production. */
export const ApnsEnvironment = Schema.Literals(["development", "production"]).annotate({ identifier: "ApnsEnvironment" })
export type ApnsEnvironment = typeof ApnsEnvironment.Type

export const DeviceId = Schema.String.pipe(Schema.brand("DeviceId"))
export type DeviceId = typeof DeviceId.Type

/** The iPhone a request comes from, once its bearer token checked out. */
export class CurrentDevice extends Context.Service<CurrentDevice, { readonly id: DeviceId; readonly name: string }>()(
  "quai/CurrentDevice"
) {}

/**
 * Quai Cloud keeps nothing: the paired iPhones, the flows and the activities live at home, in Quai
 * Home. While it isn't connected, the routes that need them answer 503.
 */
export class HomeOffline extends Schema.TaggedError<HomeOffline>()("HomeOffline", {
  message: Schema.String
}, { httpApiStatus: 503 }) {}

/** Every route that reads or writes the home's data: answers `HomeOffline` while Quai Home isn't connected. */
export class HomeRequired extends HttpApiMiddleware.Service<HomeRequired>()("quai/HomeRequired", {
  error: HomeOffline
}) {}

/** Every iPhone route: `Authorization: Bearer <device token>`, the token the pairing returned. */
export class DeviceAuth extends HttpApiMiddleware.Service<DeviceAuth, { provides: CurrentDevice }>()("quai/DeviceAuth", {
  error: [HttpApiError.Unauthorized, HomeOffline],
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
  pushToStartToken: Schema.optionalKey(Schema.String),
  /** The iPhone's time zone (IANA, "Europe/Paris"): the home's day and evening follow it. */
  timeZone: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "PairDevice" })

export const PairedDevice = Schema.Struct({
  deviceId: DeviceId,
  /** Secret: the app keeps it in the Keychain and sends it as a bearer token. */
  token: Schema.String
}).annotate({ identifier: "PairedDevice" })

export const UpdateDevice = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  pushToStartToken: Schema.optionalKey(Schema.String),
  timeZone: Schema.optionalKey(Schema.String),
  /** The APNs device token for notifications (alerts), once the user allowed them. */
  notificationToken: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "UpdateDevice" })

export const ActivityToken = Schema.Struct({
  mediaKey: Schema.String,
  pushToken: Schema.String
}).annotate({ identifier: "ActivityToken" })

/**
 * The Live Activities still on this iPhone's screen, by key. The server forgets the others (the
 * user swiped them away) and shows them again at their next real change.
 */
export const ShownActivities = Schema.Struct({
  keys: Schema.Array(Schema.String)
}).annotate({ identifier: "ShownActivities" })

/** One flow on one iPhone: on or off, and the steps it hides (never the last). */
export const FlowPreference = Schema.Struct({
  enabled: Schema.Boolean,
  hiddenSteps: Schema.Array(Schema.String)
}).annotate({ identifier: "FlowPreference" })
export type FlowPreference = typeof FlowPreference.Type

/** What this iPhone wants to receive, per flow id. A flow left out: on, every step. */
export const DevicePreferences = Schema.Struct({
  flows: Schema.Record(Schema.String, FlowPreference),
  /** Alerts this iPhone doesn't want notified. Absent: every alert. */
  mutedAlerts: Schema.optionalKey(Schema.Array(AlertKind))
}).annotate({ identifier: "DevicePreferences" })
export type DevicePreferences = typeof DevicePreferences.Type

/** A flow as the iPhone lists it in its settings. */
export const FlowSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  /** What its activities follow: the app's Home groups them by it. */
  subject: FlowSubject,
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


export const RunningActivity = Schema.Struct({
  attributes: ActivityAttributes,
  content: ActivityContent
}).annotate({ identifier: "RunningActivity" })

/** Routes the iPhone app calls. */
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
    HttpApiEndpoint.put("shownActivities", "/devices/me/activities/shown", { payload: ShownActivities })
      .annotate(OpenApi.Identifier, "reportShownActivities")
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
  .middleware(HomeRequired)
  .prefix("/api") {}

export const PairingCode = Schema.Struct({
  code: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
  /**
   * What the QR code holds, read by the app's scanner:
   * `quai://pair?code=…&url=…&url=…&header=Name%3A%20value&header=…`, every value
   * percent-encoded. `header` carries the access headers (`QUAI_PUBLIC_HEADERS`), names and
   * values: apps that predate them ignore it.
   */
  link: Schema.String,
  /** The access headers the link carries, by name only: their values are secrets. */
  accessHeaderNames: Schema.Array(Schema.String)
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
  .middleware(HomeRequired)
  .prefix("/console-api") {}

/**
 * How the app reaches Quai Cloud from outside: Quai Cloud's own configuration (`QUAI_PUBLIC_URL`,
 * `QUAI_PUBLIC_HEADERS`). The access headers are those a reverse proxy in front of the Cloud
 * requires (a Cloudflare Access service token, say): shown by name only.
 */
export const ConnectionSettings = Schema.Struct({
  publicUrl: Schema.optionalKey(Schema.String),
  accessHeaderNames: Schema.Array(Schema.String)
}).annotate({ identifier: "ConnectionSettings" })
export type ConnectionSettings = typeof ConnectionSettings.Type

/** What the console's Settings page shows of the public address. Read-only: it is set on Quai Cloud. */
export class ConnectionGroup extends HttpApiGroup.make("connection")
  .add(
    HttpApiEndpoint.get("connectionSettings", "/connection-settings", { success: ConnectionSettings })
      .annotate(OpenApi.Identifier, "getConnectionSettings")
  )
  .prefix("/console-api") {}

/** The Apple push key: Quai Cloud's own configuration (`QUAI_APNS_*`), never home data. */
export const PushSettings = Schema.Struct({
  configured: Schema.Boolean,
  keyId: Schema.optionalKey(Schema.String),
  teamId: Schema.optionalKey(Schema.String),
  /** The iOS app's bundle id the pushes target. */
  topic: Schema.String
}).annotate({ identifier: "PushSettings" })
export type PushSettings = typeof PushSettings.Type

/** What the console's Settings page shows of the push key. Read-only: it is set on Quai Cloud. */
export class PushGroup extends HttpApiGroup.make("push")
  .add(HttpApiEndpoint.get("pushSettings", "/push-settings", { success: PushSettings }).annotate(OpenApi.Identifier, "getPushSettings"))
  .prefix("/console-api") {}

export class InvalidFlow extends Schema.TaggedError<InvalidFlow>()("InvalidFlow", {
  message: Schema.String
}, { httpApiStatus: 400 }) {}

/** Which paired iPhones a flow's test plays on. */
export const TestFlow = Schema.Struct({
  deviceIds: Schema.Array(DeviceId).check(Schema.isMinLength(1))
}).annotate({ identifier: "TestFlow" })

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
    HttpApiEndpoint.post("test", "/flows/:id/test", { params: { id: Schema.String }, payload: TestFlow, error: HttpApiError.NotFound })
      .annotate(OpenApi.Identifier, "testFlow")
  )
  .middleware(HomeRequired)
  .prefix("/console-api") {}
