import { type Schema, SchemaAST } from "effect"

/**
 * Where a schema of Quai's no longer matches a service's OpenAPI spec: a field it reads that the
 * spec doesn't have, or has with another type. Only the fields Quai reads are compared, through
 * the schema's encoded side (the JSON the service answers).
 *
 * Nullability isn't compared: the *arrs' specs (Swashbuckle) mark nearly every string and array
 * `nullable`, and the recorded responses already say which ones really are.
 */

/** The part of an OpenAPI 3 document the comparison reads. */
export interface OpenApiSpec {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>
  readonly components?: { readonly schemas?: Readonly<Record<string, JsonSchema>> }
}

interface Operation {
  readonly responses?: Readonly<
    Record<string, { readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>> }>
  >
}

/** A JSON Schema of the spec, as Swashbuckle writes them. */
export interface JsonSchema {
  readonly $ref?: string
  readonly type?: string
  /** Not compared: `int32`, `int64`, `date-time`… all decode as a number or a string. */
  readonly format?: string
  /** Not compared, see above. */
  readonly nullable?: boolean
  readonly enum?: ReadonlyArray<unknown>
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly additionalProperties?: boolean | JsonSchema
  readonly items?: JsonSchema
  readonly allOf?: ReadonlyArray<JsonSchema>
  readonly oneOf?: ReadonlyArray<JsonSchema>
  readonly anyOf?: ReadonlyArray<JsonSchema>
}

/** One read of Quai's: the GET it sends and the schema of the body. */
export interface SpecRead {
  readonly path: string
  readonly schema: Schema.Top
}

/** The spec's path template matching a concrete path (query left out): `/api/v3/movie/{id}` for `/api/v3/movie/12`. */
export const templateOf = (spec: OpenApiSpec, path: string): string | undefined => {
  const segments = (path.split("?")[0] ?? "").split("/")
  const matches = (template: string) => {
    const parts = template.split("/")
    return parts.length === segments.length
      && parts.every((part, index) => part === segments[index] || /^\{.+\}$/.test(part))
  }
  const templates = Object.keys(spec.paths).filter(matches)
  // A literal segment beats a parameter: `/api/v3/queue/details` over `/api/v3/queue/{id}`.
  return templates.sort((left, right) => right.split("{").length - left.split("{").length).at(-1)
}

const resolve = (spec: OpenApiSpec, schema: JsonSchema): JsonSchema => {
  if (schema.$ref !== undefined) {
    const name = schema.$ref.replace("#/components/schemas/", "")
    const target = spec.components?.schemas?.[name]
    return target === undefined ? {} : resolve(spec, target)
  }
  // Swashbuckle wraps a nullable reference in a one-element allOf.
  const [only] = schema.allOf ?? []
  return schema.allOf?.length === 1 && only !== undefined ? resolve(spec, only) : schema
}

const jsonTypeOf = (value: unknown): string => typeof value === "number" ? "number" : typeof value

type Leaf = "String" | "Number" | "Boolean"
const leafAccepts: Record<Leaf, ReadonlyArray<string>> = {
  String: ["string"],
  Number: ["number", "integer"],
  Boolean: ["boolean"]
}

const isLeaf = (tag: string): tag is Leaf => Object.hasOwn(leafAccepts, tag)

/** What the spec says a value is, for a message: `string`, `QueueStatus`, `object`. */
const described = (schema: JsonSchema): string =>
  schema.$ref?.replace("#/components/schemas/", "") ?? schema.type ?? "anything"

/** An untyped spec value (`{}`) or one of several shapes: Quai's schema can't be told wrong. */
const isOpen = (schema: JsonSchema) =>
  schema.type === undefined && schema.properties === undefined && schema.items === undefined
  && schema.enum === undefined

/** Where a comparison stands: the spec, the field's path for messages, and what the spec calls the value. */
interface Place {
  readonly spec: OpenApiSpec
  readonly at: string
  readonly name: string
}

const compare = (spec: OpenApiSpec, ast: SchemaAST.AST, raw: JsonSchema, at: string): ReadonlyArray<string> => {
  const target = resolve(spec, raw)
  if (isOpen(target)) return []
  return compareNode(ast, target, { spec, at, name: described(raw) })
}

const compareNode = (ast: SchemaAST.AST, target: JsonSchema, place: Place): ReadonlyArray<string> => {
  if (ast._tag === "Suspend") return compare(place.spec, ast.thunk(), target, place.at)
  if (ast._tag === "Union") return compareUnion(ast, target, place)
  if (ast._tag === "Objects") return compareObject(ast, target, place)
  if (ast._tag === "Arrays") return compareArray(ast, target, place)
  if (ast._tag === "Literal") return compareLiteral(ast.literal, target, place)
  if (isLeaf(ast._tag)) {
    return leafAccepts[ast._tag].includes(target.type ?? "")
      ? []
      : [`${place.at}: Quai reads a ${ast._tag.toLowerCase()}, the spec has ${place.name}`]
  }
  // Unknown, Any, Null, Undefined, a Declaration: nothing the spec could contradict.
  return []
}

// A union holds when one of its shapes does (`NullOr(String)` against a string), and each literal it
// matches on is still a value of the spec's: `Literals(["announced", "inCinemas"])` names two.
const compareUnion = (ast: SchemaAST.Union, target: JsonSchema, place: Place): ReadonlyArray<string> => {
  const members = ast.types.filter((member) => member._tag !== "Null" && member._tag !== "Undefined")
  const literals = members.filter((member) => member._tag === "Literal")
  const shapes = members.filter((member) => member._tag !== "Literal")
  const literalDrifts = literals.flatMap((member) => compareNode(member, target, place))
  const shapeDrifts = shapes.map((member) => compareNode(member, target, place))
  const shapesHold = shapeDrifts.length === 0 || shapeDrifts.some((drift) => drift.length === 0)
  return [...literalDrifts, ...(shapesHold ? [] : shapeDrifts.flat())]
}

const compareObject = (ast: SchemaAST.Objects, target: JsonSchema, place: Place): ReadonlyArray<string> => {
  if (target.properties === undefined) {
    // A dictionary (`additionalProperties`) has no field names to check.
    return target.additionalProperties !== undefined
      ? []
      : [`${place.at}: Quai reads an object, the spec has ${place.name}`]
  }
  const properties = target.properties
  return ast.propertySignatures.flatMap((property) => {
    const key = String(property.name)
    const field = properties[key]
    return field === undefined
      ? [`${place.at}.${key}: Quai reads it, ${place.name} has no such field`]
      : compare(place.spec, property.type, field, `${place.at}.${key}`)
  })
}

const compareArray = (ast: SchemaAST.Arrays, target: JsonSchema, place: Place): ReadonlyArray<string> => {
  if (target.type !== "array") return [`${place.at}: Quai reads an array, the spec has ${place.name}`]
  const [element] = ast.rest
  return element === undefined || target.items === undefined
    ? []
    : compare(place.spec, element, target.items, `${place.at}[]`)
}

// A literal Quai matches on must still be one of the spec's values: an enum's member, or its type.
const compareLiteral = (literal: unknown, target: JsonSchema, place: Place): ReadonlyArray<string> => {
  if (target.enum !== undefined) {
    return target.enum.includes(literal)
      ? []
      : [`${place.at}: Quai reads "${String(literal)}", not a value of ${place.name}`]
  }
  const accepted = target.type === "integer" ? "number" : target.type
  return accepted === jsonTypeOf(literal)
    ? []
    : [`${place.at}: Quai reads "${String(literal)}", the spec has ${place.name}`]
}

const responseOf = (spec: OpenApiSpec, template: string): JsonSchema | undefined => {
  const content = spec.paths[template]?.["get"]?.responses?.["200"]?.content ?? {}
  return (content["application/json"] ?? Object.values(content)[0])?.schema
}

/** Every drift between one read of Quai's and the spec of the service it reads. */
export const driftOf = (spec: OpenApiSpec, read: SpecRead): ReadonlyArray<string> => {
  const template = templateOf(spec, read.path)
  if (template === undefined) return [`GET ${read.path}: not in the spec`]
  const response = responseOf(spec, template)
  if (response === undefined) return [`GET ${template}: the spec gives no body for a 200`]
  return compare(spec, SchemaAST.toEncoded(read.schema.ast), response, `GET ${template}`)
}
