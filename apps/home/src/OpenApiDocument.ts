import { HomeConsoleApi, HomeProtocol, QuaiApi } from "@quai/api"
import { OpenApi } from "effect/http-api"
import { webhookServices } from "./Webhooks.ts"

type Spec = OpenApi.OpenAPISpec
type PathItem = Spec["paths"][string]

/** Who reaches a route of Quai Home: the first tag of each of its operations. */
export const audiences = {
  app: "From the app, through Quai Cloud",
  console: "From the console",
  services: "From the services, at home"
} as const

/**
 * Who reaches this path. The app's requests are the API's routes, relayed by Quai Cloud and never
 * served on Quai Home's port; the console's are on the port, behind its password; a service posts
 * its webhooks there, and anything at home may ask whether Quai Home is up.
 */
export const audienceOf = (path: string): string => {
  if (path === "/health" || path.startsWith("/webhooks/")) return audiences.services
  return HomeProtocol.isAppPath(path) ? audiences.app : audiences.console
}

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const

/** The path's operations, each tagged first with who reaches it. */
const tagged = (path: string, item: PathItem): PathItem => {
  const audience = audienceOf(path)
  const result: PathItem = { ...item }
  for (const method of methods) {
    const operation = item[method]
    if (operation !== undefined) result[method] = { ...operation, tags: [audience, ...operation.tags] }
  }
  return result
}

/** What Quai Home answers itself, outside the two APIs: its health and the services' webhooks. */
const ownPaths: Spec["paths"] = {
  "/health": {
    get: {
      operationId: "getHomeHealth",
      summary: "Whether Quai Home is up, linked to Quai Cloud, and as which home.",
      tags: ["home"],
      parameters: [],
      security: [],
      responses: {
        200: {
          description: "Up.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status", "linked", "homeId"],
                properties: {
                  status: { type: "string", enum: ["ok"] },
                  linked: { type: "boolean" },
                  homeId: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  },
  "/webhooks/{service}": {
    post: {
      operationId: "receiveWebhook",
      summary: "A webhook of Radarr, Sonarr or Seerr, which Quai Home set up itself.",
      tags: ["home"],
      parameters: [
        {
          name: "service",
          in: "path",
          required: true,
          schema: { type: "string", enum: [...webhookServices] }
        },
        {
          name: "token",
          in: "query",
          required: true,
          description: "The home's webhook token, which Quai Home put in the address it gave the service.",
          schema: { type: "string" }
        }
      ],
      security: [],
      responses: {
        204: { description: "Taken." },
        400: { description: "Not JSON." },
        401: { description: "Not the home's token." }
      }
    }
  }
}

const description = [
  "Everything Quai Home answers, by who reaches it (the first tag of each route).",
  `- **${audiences.app}**: the API's routes. They are on no port of Quai Home: Quai Cloud relays them over ` +
  "the link Quai Home opened, and Quai Home checks the iPhone's token and, for an iPhone paired with a device " +
  "key, the request's signature.",
  `- **${audiences.console}**: on Quai Home's port, behind the console's password (a session cookie). ` +
  "`/console-api` never leaves home.",
  `- **${audiences.services}**: on Quai Home's port. The webhooks carry the home's token.`
].join("\n")

/** Names both documents define, when what they define differs: one would hide the other. */
export const clashes = (left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>) =>
  Object.keys(left).filter((name) =>
    Object.hasOwn(right, name) && JSON.stringify(left[name]) !== JSON.stringify(right[name])
  )

/**
 * One OpenAPI document for everything Quai Home answers: its own console API (`HomeConsoleApi`),
 * the contract its domain implements (`QuaiApi`: the app's routes and the console's), its health
 * and the webhooks. Made from the same definitions the routes are built from, so it can't drift.
 */
export const homeOpenApi = (version: string): Spec => {
  const home = OpenApi.fromApi(HomeConsoleApi)
  const quai = OpenApi.fromApi(QuaiApi)
  const paths = { ...ownPaths, ...home.paths, ...quai.paths }
  const used = new Set([...home.tags, ...quai.tags].map((tag) => tag.name))
  return {
    openapi: "3.1.0",
    info: { title: "Quai Home", version, description },
    paths: Object.fromEntries(Object.entries(paths).map(([path, item]) => [path, tagged(path, item)])),
    components: {
      schemas: { ...home.components.schemas, ...quai.components.schemas },
      securitySchemes: { ...home.components.securitySchemes, ...quai.components.securitySchemes }
    },
    security: [],
    tags: [
      ...Object.values(audiences).map((name) => ({ name })),
      ...(used.has("home") ? [] : [{ name: "home" }]),
      ...home.tags,
      ...quai.tags.filter((tag) => !home.tags.some((other) => other.name === tag.name))
    ]
  }
}
