/** A spec cut to some of its paths, with the components they reference: Jellyfin's is too big to commit whole. */

type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

/** The part of an OpenAPI document the cut changes; the rest is kept as it is. */
export interface Spec {
  readonly paths: Readonly<Record<string, Json>>
  readonly components?: { readonly schemas?: Readonly<Record<string, Json>> }
}

/** The components a part of the spec references, and the ones those reference in turn. */
export const referenced = (spec: Spec, start: Json): ReadonlySet<string> => {
  const names = new Set<string>()
  const visit = (node: Json): void => {
    if (node === null || typeof node !== "object") return
    const children: ReadonlyArray<[string, Json]> = Array.isArray(node)
      ? node.map((child: Json) => ["", child])
      : Object.entries(node)
    for (const [key, value] of children) {
      if (key !== "$ref" || typeof value !== "string") {
        visit(value)
        continue
      }
      const name = value.replace("#/components/schemas/", "")
      if (names.has(name)) continue
      names.add(name)
      visit(spec.components?.schemas?.[name] ?? null)
    }
  }
  visit(start)
  return names
}

/** The spec with only these paths and what they reference. */
export const kept = (spec: Spec, paths: ReadonlyArray<string>): Spec => {
  const keptPaths = Object.fromEntries(Object.entries(spec.paths).filter(([path]) => paths.includes(path)))
  const names = referenced(spec, keptPaths)
  const schemas = Object.entries(spec.components?.schemas ?? {}).filter(([name]) => names.has(name))
  return { ...spec, paths: keptPaths, components: { schemas: Object.fromEntries(schemas) } }
}
