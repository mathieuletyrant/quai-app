import { HomeConsoleApi, QuaiApi } from "@quai/api"
import { OpenApi } from "effect/http-api"
import { describe, expect, it } from "vitest"
import { audienceOf, audiences, clashes, homeOpenApi } from "../src/OpenApiDocument.ts"

const document = homeOpenApi("2.4.0")
const methods = ["get", "put", "post", "delete", "patch"] as const
const operations = Object.entries(document.paths).flatMap(([path, item]) =>
  methods.flatMap((method) => item[method] === undefined ? [] : [{ path, method, operation: item[method] }])
)

describe("who reaches a route of Quai Home", () => {
  it("the app, through Quai Cloud, for the API's routes; the console for its own; the services for the rest", () => {
    expect(audienceOf("/api/library")).toBe(audiences.app)
    expect(audienceOf("/api/devices")).toBe(audiences.app)
    expect(audienceOf("/console-api/devices")).toBe(audiences.console)
    expect(audienceOf("/home-api/services")).toBe(audiences.console)
    expect(audienceOf("/health")).toBe(audiences.services)
    expect(audienceOf("/webhooks/{service}")).toBe(audiences.services)
    // A path that only looks like the API's isn't the app's.
    expect(audienceOf("/api/../console-api/devices")).toBe(audiences.console)
  })
})

describe("Quai Home's OpenAPI document", () => {
  it("is OpenAPI 3.1, named Quai Home, at the version it runs", () => {
    expect(document.openapi).toBe("3.1.0")
    expect(document.info).toMatchObject({ title: "Quai Home", version: "2.4.0" })
    for (const audience of Object.values(audiences)) expect(document.info.description).toContain(audience)
  })

  it("holds every route of both APIs, with its health and the webhooks: nothing Quai Home answers is left out", () => {
    const home = Object.keys(OpenApi.fromApi(HomeConsoleApi).paths)
    const quai = Object.keys(OpenApi.fromApi(QuaiApi).paths)
    expect(home.length).toBeGreaterThan(0)
    expect(quai.length).toBeGreaterThan(0)
    expect(Object.keys(document.paths).sort()).toEqual(
      [...new Set([...home, ...quai, "/health", "/webhooks/{service}"])].sort()
    )
    // The two APIs share no path: one would hide the other.
    expect(home.filter((path) => quai.includes(path))).toEqual([])
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(["/api/library", "/api/devices", "/console-api/devices", "/home-api/services"])
    )
  })

  it("tags each route first with who reaches it, and keeps its own tags", () => {
    expect(operations.length).toBeGreaterThan(30)
    for (const { path, operation } of operations) {
      expect(operation.tags[0], path).toBe(audienceOf(path))
      expect(operation.tags.length, path).toBeGreaterThan(1)
    }
    const library = document.paths["/api/library"]!.get!
    expect(library.tags).toEqual([audiences.app, "library"])
    expect(document.paths["/webhooks/{service}"]!.post!.tags).toEqual([audiences.services, "home"])
  })

  it("lists every tag its routes use, the three audiences first, each once", () => {
    const listed = document.tags.map((tag) => tag.name)
    expect(listed.slice(0, 3)).toEqual(Object.values(audiences))
    expect(new Set(listed).size).toBe(listed.length)
    for (const { operation } of operations) {
      for (const tag of operation.tags) expect(listed).toContain(tag)
    }
  })

  it("keeps the schemas and the security schemes of both APIs, which never define one name two ways", () => {
    const home = OpenApi.fromApi(HomeConsoleApi).components
    const quai = OpenApi.fromApi(QuaiApi).components
    expect(clashes(home.schemas, quai.schemas)).toEqual([])
    expect(clashes(home.securitySchemes, quai.securitySchemes)).toEqual([])
    expect(Object.keys(document.components.schemas).sort()).toEqual(
      [...new Set([...Object.keys(home.schemas), ...Object.keys(quai.schemas)])].sort()
    )
    expect(Object.keys(document.components.securitySchemes)).toEqual(
      expect.arrayContaining([...Object.keys(home.securitySchemes), ...Object.keys(quai.securitySchemes)])
    )
    // Every schema a route points to is there.
    const text = JSON.stringify(document.paths)
    for (const [, name] of text.matchAll(/#\/components\/schemas\/([A-Za-z0-9_.-]+)/g)) {
      expect(document.components.schemas, name).toHaveProperty(name!)
    }
  })

  it("says what a webhook needs and what the health answers", () => {
    const webhook = document.paths["/webhooks/{service}"]!.post!
    expect(webhook.parameters.map((parameter) => `${parameter.in} ${parameter.name}`)).toEqual([
      "path service",
      "query token"
    ])
    expect(webhook.parameters[0]!.schema).toEqual({ type: "string", enum: ["radarr", "sonarr", "seerr"] })
    expect(Object.keys(webhook.responses)).toEqual(["204", "400", "401"])
    expect(Object.keys(document.paths["/health"]!.get!.responses)).toEqual(["200"])
  })
})

describe("names two documents define", () => {
  it("clash only when what they define differs", () => {
    expect(clashes({ A: { type: "string" }, B: 1 }, { A: { type: "string" }, C: 2 })).toEqual([])
    expect(clashes({ A: { type: "string" } }, { A: { type: "number" } })).toEqual(["A"])
    expect(clashes({}, { A: 1 })).toEqual([])
  })
})
