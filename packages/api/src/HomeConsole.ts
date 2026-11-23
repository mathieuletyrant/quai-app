import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api"
import { HomeService } from "./Home.ts"

/**
 * The routes Quai Home serves its console itself (`/home-api`): the sign-in, where the home stands
 * and the services' addresses and keys, which never leave home. The rest of the console
 * (`/console-api`) is Quai Cloud's, relayed by Quai Home over its link. Not part of `QuaiApi`: the
 * iPhone app never calls these.
 */

/** The console's session cookie, set by `signIn`. */
export const consoleSession = HttpApiSecurity.apiKey({ in: "cookie", key: "quai_session" })

/** Every route but the sign-in itself: a valid session cookie, or 401. */
export class ConsoleSession extends HttpApiMiddleware.Service<ConsoleSession>()("quai-home/ConsoleSession", {
  error: HttpApiError.Unauthorized,
  security: { cookie: consoleSession }
}) {}

/**
 * Whether the console can be opened: `locked` while `QUAI_HOME_PASSWORD` isn't set (nothing to sign
 * in with), else signed in or not.
 */
export const ConsoleAccess = Schema.Struct({
  state: Schema.Literals(["locked", "signedOut", "signedIn"])
}).annotate({ identifier: "ConsoleAccess" })
export type ConsoleAccess = typeof ConsoleAccess.Type

export class WrongPassword extends Schema.TaggedError<WrongPassword>()("WrongPassword", {
  message: Schema.String
}, { httpApiStatus: 401 }) {}

export class SessionGroup extends HttpApiGroup.make("session")
  .add(HttpApiEndpoint.get("access", "/session", { success: ConsoleAccess }))
  .add(HttpApiEndpoint.post("signIn", "/session", {
    payload: Schema.Struct({ password: Schema.String }),
    success: HttpApiSchema.NoContent,
    error: WrongPassword
  }))
  .add(HttpApiEndpoint.delete("signOut", "/session", { success: HttpApiSchema.NoContent }))
  .prefix("/home-api") {}

/** The Quai Cloud this home links to: `QUAI_CLOUD_URL`, set on Quai Home only. */
export const CloudLink = Schema.Struct({
  /** Whether `QUAI_CLOUD_URL` is set. */
  configured: Schema.Boolean,
  /** Whether the Cloud welcomed this home on the current connection. */
  linked: Schema.Boolean,
  /**
   * Where the iPhone app reaches the Cloud at home, put in the pairing QR code:
   * `QUAI_CLOUD_APP_URL`, else `QUAI_CLOUD_URL` in http(s) without its `/home`.
   */
  url: Schema.optionalKey(Schema.String),
  /**
   * The Cloud this home linked to before, when it isn't this one: the paired iPhones still talk to
   * that one, and must be paired again. Gone once acknowledged.
   */
  previousUrl: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "CloudLink" })
export type CloudLink = typeof CloudLink.Type

export const HomeOverview = Schema.Struct({
  homeId: Schema.String,
  version: Schema.String,
  cloud: CloudLink
}).annotate({ identifier: "HomeOverview" })
export type HomeOverview = typeof HomeOverview.Type

export class HomeStatusGroup extends HttpApiGroup.make("home")
  .add(HttpApiEndpoint.get("overview", "/home", { success: HomeOverview }))
  /** The iPhones were paired again (or will be): forget the Cloud this home linked to before. */
  .add(HttpApiEndpoint.post("acknowledgeCloud", "/home/cloud-changed", { success: HttpApiSchema.NoContent }))
  .middleware(ConsoleSession)
  .prefix("/home-api") {}

/** What reaching a service with its address and key gave. */
export const ServiceCheck = Schema.Struct({
  outcome: Schema.Literals(["ok", "refused", "unreachable", "failed"]),
  /** In words: "Radarr 6.0.4", "Radarr refused the key (HTTP 401)". */
  message: Schema.String,
  /** The version the service reported, when it did: "6.0.4". */
  version: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "ServiceCheck" })
export type ServiceCheck = typeof ServiceCheck.Type

/**
 * Where a service's address and key come from: an environment variable (`QUAI_RADARR_URL`…), which
 * wins and can't be changed here; the console's Services page, kept in `/data`; or nowhere yet.
 */
export const ServiceSource = Schema.Literals(["environment", "saved", "none"])
export type ServiceSource = typeof ServiceSource.Type

/** A service as the Services page shows it. Never its key or password: only whether one is set. */
export const ServiceSetup = Schema.Struct({
  service: HomeService,
  source: ServiceSource,
  url: Schema.optionalKey(Schema.String),
  /** qBittorrent's user name. */
  username: Schema.optionalKey(Schema.String),
  /** Whether a key (qBittorrent: a password) is set. */
  hasSecret: Schema.Boolean,
  /** For a service not set yet: the address Quai Home's environment gives it, to fill in the form. */
  suggestedUrl: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "ServiceSetup" })
export type ServiceSetup = typeof ServiceSetup.Type

/**
 * A service's address and key, from the Services page. A secret left out keeps the one saved: the
 * page never reads a key back, it only replaces it. qBittorrent takes a user name and password,
 * the other services a key.
 */
export const ServiceInput = Schema.Struct({
  url: Schema.String,
  secret: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "ServiceInput" })
export type ServiceInput = typeof ServiceInput.Type

/** The service is set by an environment variable: change it there. */
export class SetByEnvironment extends Schema.TaggedError<SetByEnvironment>()("SetByEnvironment", {
  message: Schema.String
}, { httpApiStatus: 409 }) {}

export class InvalidService extends Schema.TaggedError<InvalidService>()("InvalidService", {
  message: Schema.String
}, { httpApiStatus: 400 }) {}

/** A saved service, and what reaching it gave just after. */
export const SavedService = Schema.Struct({
  setup: ServiceSetup,
  check: ServiceCheck
}).annotate({ identifier: "SavedService" })

export class ServicesGroup extends HttpApiGroup.make("services")
  .add(HttpApiEndpoint.get("list", "/services", { success: Schema.Array(ServiceSetup) }))
  .add(HttpApiEndpoint.put("save", "/services/:service", {
    params: { service: HomeService },
    payload: ServiceInput,
    success: SavedService,
    error: [SetByEnvironment, InvalidService]
  }))
  .add(HttpApiEndpoint.delete("remove", "/services/:service", {
    params: { service: HomeService },
    success: HttpApiSchema.NoContent,
    error: SetByEnvironment
  }))
  .add(HttpApiEndpoint.post("check", "/services/:service/check", {
    params: { service: HomeService },
    success: ServiceCheck
  }))
  .middleware(ConsoleSession)
  .prefix("/home-api") {}

/** What Quai Home serves its console, next to the relayed `/console-api`. */
export class HomeConsoleApi extends HttpApi.make("quai-home").add(SessionGroup).add(HomeStatusGroup).add(ServicesGroup) {}
