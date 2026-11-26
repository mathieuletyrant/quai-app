import { describe, expect, it } from "@effect/vitest"
import { kept, type Spec } from "../scripts/keptPaths.ts"

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

const spec: Spec = {
  paths: { "/Items": { get: { schema: ref("ItemsResult") } }, "/System/Info": { get: { schema: ref("SystemInfo") } } },
  components: {
    schemas: {
      ItemsResult: { properties: { Items: { items: ref("Item") } } },
      Item: { properties: { Parent: ref("Item"), Kind: { allOf: [ref("ItemKind")] } } },
      ItemKind: { enum: ["Movie", "Series"] },
      SystemInfo: { properties: { Version: { type: "string" } } }
    }
  }
}

describe("kept", () => {
  it("keeps the paths asked for and every component they reach, through nesting and cycles", () => {
    const cut = kept(spec, ["/Items"])
    expect(Object.keys(cut.paths)).toEqual(["/Items"])
    expect(Object.keys(cut.components?.schemas ?? {})).toEqual(["ItemsResult", "Item", "ItemKind"])
  })

  it("keeps nothing for a path the spec doesn't have", () => {
    expect(kept(spec, ["/Sessions"])).toEqual({ paths: {}, components: { schemas: {} } })
  })
})
