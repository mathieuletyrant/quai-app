import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { openApiJson } from "../src/openapi.ts"

/**
 * What the iPhone's generated client needs from the contract, checked without a Mac: Swift
 * OpenAPI Generator only sees the tags listed in its config, and turns a non-finite number into
 * an enum instead of a `Double`.
 */

type Operation = { readonly tags?: ReadonlyArray<string> }
type Spec = {
  readonly paths: Record<string, Record<string, Operation>>
  readonly components?: { readonly schemas?: Record<string, unknown> }
}

const spec: Spec = JSON.parse(openApiJson())

/** Tags under `/api/*` the app doesn't call. Empty for now: the iPhone calls every one. */
const leftOutOfTheApp: ReadonlyArray<string> = []

/** `filter.tags` of apps/ios/Quai/openapi-generator-config.yaml, read without a YAML parser. */
const generatorTags = (): ReadonlyArray<string> => {
  const config = readFileSync(new URL("../../../apps/ios/Quai/openapi-generator-config.yaml", import.meta.url), "utf8")
  const lines = config.split("\n")
  const start = lines.findIndex((line) => line.trim() === "tags:")
  const tags: Array<string> = []
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+(\S+)\s*$/.exec(line)
    if (item === null) break
    tags.push(item[1]!)
  }
  return tags
}

const appOperations = () =>
  Object.entries(spec.paths)
    .filter(([path]) => path.startsWith("/api/"))
    .flatMap(([path, operations]) => Object.entries(operations).map(([method, operation]) => ({ route: `${method.toUpperCase()} ${path}`, operation })))

/** Every `$ref`'d schema reachable from a value, by name. */
const reachableSchemas = (start: unknown): Set<string> => {
  const schemas = spec.components?.schemas ?? {}
  const seen = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value === null || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        const name = child.replace("#/components/schemas/", "")
        if (!seen.has(name)) {
          seen.add(name)
          walk(schemas[name])
        }
      } else {
        walk(child)
      }
    }
  }
  walk(start)
  return seen
}

/** `Schema.Number` in the OpenAPI: a number, or one of the strings for the values JSON can't hold. */
const isNonFiniteNumber = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return false
  const anyOf = (value as { anyOf?: ReadonlyArray<unknown> }).anyOf
  return Array.isArray(anyOf) && JSON.stringify(anyOf).match(/"(-?Infinity|NaN)"/) !== null
}

/** Where a value holds that shape, as JSON paths. */
const nonFiniteNumbers = (value: unknown, path: string): ReadonlyArray<string> => {
  if (isNonFiniteNumber(value)) return [path]
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, child]) => nonFiniteNumbers(child, `${path}.${key}`))
}

describe("the iPhone's generated client", () => {
  it("is generated for every tag under /api/* (apps/ios/Quai/openapi-generator-config.yaml)", () => {
    const listed = new Set([...generatorTags(), ...leftOutOfTheApp])
    const missing = appOperations()
      .flatMap(({ route, operation }) => (operation.tags ?? []).filter((tag) => !listed.has(tag)).map((tag) => `${tag} (${route})`))
    expect(missing).toEqual([])
  })

  it("lists no tag the contract doesn't have", () => {
    const tags = new Set(appOperations().flatMap(({ operation }) => operation.tags ?? []))
    expect(generatorTags().filter((tag) => !tags.has(tag))).toEqual([])
  })

  it("gets a Double for every number: Schema.Finite, not Schema.Number", () => {
    const schemas = spec.components?.schemas ?? {}
    const names = reachableSchemas(appOperations().map(({ operation }) => operation))
    const found = [
      ...appOperations().flatMap(({ route, operation }) => nonFiniteNumbers(operation, route)),
      ...[...names].sort().flatMap((name) => nonFiniteNumbers(schemas[name], name))
    ]
    expect(found).toEqual([])
  })
})

describe("the checks themselves", () => {
  it("see Schema.Number's shape", () => {
    expect(isNonFiniteNumber({ anyOf: [{ type: "number" }, { type: "string", enum: ["Infinity", "-Infinity", "NaN"] }] })).toBe(true)
    expect(isNonFiniteNumber({ type: "number" })).toBe(false)
  })

  it("read the generator's tags", () => {
    expect(generatorTags()).toContain("system")
  })
})
