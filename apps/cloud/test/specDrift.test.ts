import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { readFileSync } from "node:fs"
import { QueuePage } from "../src/integrations/arr.ts"
import { driftOf, type JsonSchema, type OpenApiSpec, templateOf } from "./specDrift.ts"

const ok = (schema: JsonSchema) => ({ responses: { "200": { content: { "application/json": { schema } } } } })

const specWith = (path: string, schema: JsonSchema, schemas: Record<string, JsonSchema> = {}): OpenApiSpec => ({
  paths: { [path]: { get: ok(schema) } },
  components: { schemas }
})

const Movie: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer", format: "int32" },
    title: { type: "string", nullable: true },
    status: { $ref: "#/components/schemas/MovieStatus" },
    tags: { type: "array", items: { type: "integer" } },
    statistics: { allOf: [{ $ref: "#/components/schemas/Statistics" }] },
    extra: { type: "object", additionalProperties: { type: "string" } },
    anything: {}
  }
}
const schemas = {
  Movie,
  MovieStatus: { type: "string", enum: ["announced", "released"] },
  Statistics: { type: "object", properties: { sizeOnDisk: { type: "integer", format: "int64" } } }
}
const movies = specWith("/api/v3/movie", { type: "array", items: { $ref: "#/components/schemas/Movie" } }, schemas)

const read = (schema: Schema.Top) => ({ path: "/api/v3/movie?tmdbId=1", schema })
const movieRead = (fields: Schema.Struct.Fields) => read(Schema.Array(Schema.Struct(fields)))

describe("driftOf", () => {
  it("holds when every field read is in the spec with its type", () => {
    expect(driftOf(
      movies,
      movieRead({
        id: Schema.Number,
        title: Schema.optional(Schema.NullOr(Schema.String)),
        status: Schema.Literals(["announced", "released"]),
        tags: Schema.Array(Schema.Number),
        statistics: Schema.Struct({ sizeOnDisk: Schema.Number }),
        extra: Schema.Struct({ whatever: Schema.String }),
        anything: Schema.Boolean
      })
    )).toEqual([])
  })

  it("reports a field the spec doesn't have", () => {
    expect(driftOf(movies, movieRead({ year: Schema.Number })))
      .toEqual(["GET /api/v3/movie[].year: Quai reads it, Movie has no such field"])
  })

  it("reports a field whose type changed", () => {
    expect(driftOf(movies, movieRead({ id: Schema.String })))
      .toEqual(["GET /api/v3/movie[].id: Quai reads a string, the spec has integer"])
  })

  it("reports a value the spec's enum no longer has", () => {
    expect(driftOf(movies, movieRead({ status: Schema.Literals(["announced", "inCinemas"]) })))
      .toEqual(["GET /api/v3/movie[].status: Quai reads \"inCinemas\", not a value of MovieStatus"])
  })

  it("reads through a nullable reference (Swashbuckle's one-element allOf)", () => {
    expect(driftOf(movies, movieRead({ statistics: Schema.Struct({ sizeOnDisk: Schema.String }) })))
      .toEqual(["GET /api/v3/movie[].statistics.sizeOnDisk: Quai reads a string, the spec has integer"])
  })

  it("reports an array the spec answers as an object, and the reverse", () => {
    expect(driftOf(movies, read(Schema.Struct({ records: Schema.Array(Schema.Unknown) }))))
      .toEqual(["GET /api/v3/movie: Quai reads an object, the spec has array"])
    expect(driftOf(movies, movieRead({ title: Schema.Array(Schema.String) })))
      .toEqual(["GET /api/v3/movie[].title: Quai reads an array, the spec has string"])
  })

  it("holds a union when one of its members does", () => {
    expect(driftOf(movies, movieRead({ id: Schema.Union([Schema.String, Schema.Number]) }))).toEqual([])
  })

  it("compares the encoded side: what the service answers", () => {
    expect(driftOf(movies, movieRead({ id: Schema.NumberFromString }))).toEqual([
      "GET /api/v3/movie[].id: Quai reads a string, the spec has integer"
    ])
  })

  it("reports a path the spec doesn't have, or answers without a body", () => {
    expect(driftOf(movies, { path: "/api/v3/films", schema: Schema.Unknown }))
      .toEqual(["GET /api/v3/films: not in the spec"])
    const empty: OpenApiSpec = { paths: { "/api/v3/movie": { get: { responses: { "200": {} } } } } }
    expect(driftOf(empty, read(Schema.Unknown))).toEqual(["GET /api/v3/movie: the spec gives no body for a 200"])
  })
})

describe("templateOf", () => {
  const spec: OpenApiSpec = { paths: { "/api/v3/queue/{id}": {}, "/api/v3/queue/details": {}, "/api/v3/queue": {} } }

  it("leaves the query out and matches parameters", () => {
    expect(templateOf(spec, "/api/v3/queue?page=1")).toBe("/api/v3/queue")
    expect(templateOf(spec, "/api/v3/queue/12")).toBe("/api/v3/queue/{id}")
  })

  it("prefers a literal segment to a parameter", () => {
    expect(templateOf(spec, "/api/v3/queue/details")).toBe("/api/v3/queue/details")
  })

  it("leaves out the path the server URL ends with (Seerr's `{server}/api/v1`)", () => {
    const seerr: OpenApiSpec = { servers: [{ url: "{server}/api/v1" }], paths: { "/request/{requestId}": {} } }
    expect(templateOf(seerr, "/api/v1/request/3")).toBe("/request/{requestId}")
    const hosted: OpenApiSpec = { servers: [{ url: "https://seerr.example/api/v1/" }], paths: { "/user": {} } }
    expect(templateOf(hosted, "/api/v1/user?take=100")).toBe("/user")
  })

  it("finds nothing for a path of another length", () => {
    expect(templateOf(spec, "/api/v3/queue/12/more")).toBeUndefined()
  })
})

describe("on Radarr's real spec", () => {
  const radarr = JSON.parse(
    readFileSync(new URL("fixtures/specs/radarr.json", import.meta.url), "utf8")
  ) as OpenApiSpec & { components: { schemas: Record<string, { properties: Record<string, unknown> }> } }

  it("goes red when a field Quai reads leaves the spec", () => {
    const { trackedDownloadState: _removed, ...rest } = radarr.components.schemas["QueueResource"]?.properties ?? {}
    const changed = {
      ...radarr,
      components: { schemas: { ...radarr.components.schemas, QueueResource: { type: "object", properties: rest } } }
    }
    expect(driftOf(changed, { path: "/api/v3/queue", schema: QueuePage })).toContain(
      "GET /api/v3/queue.records[].trackedDownloadState: Quai reads it, QueueResource has no such field"
    )
  })
})
