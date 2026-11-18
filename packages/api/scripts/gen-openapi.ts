import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { openApiJson } from "../src/openapi.ts"

const target = fileURLToPath(new URL("../openapi.json", import.meta.url))
writeFileSync(target, openApiJson())
console.log(`OpenAPI écrit dans ${target}`)
