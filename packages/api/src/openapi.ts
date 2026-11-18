import { OpenApi } from "effect/http-api"
import { QuaiApi } from "./index.ts"

export const openApiJson = (): string => JSON.stringify(OpenApi.fromApi(QuaiApi), null, 2) + "\n"
