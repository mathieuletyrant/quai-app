import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Fixes } from "../fixes/Fixes.ts"

/** The To fix list for the app: `/api/fixes`, behind the iPhone's token. */
export const FixesHandlers = HttpApiBuilder.group(QuaiApi, "fixes", (handlers) =>
  Effect.gen(function*() {
    const fixes = yield* Fixes
    return handlers
      .handle("list", () => fixes.list)
      .handle("remove", ({ params, payload }) => fixes.remove(params.id, payload.blocklist))
      .handle("importPreview", ({ params }) => fixes.importPreview(params.id))
      .handle("import", ({ params, payload }) => fixes.importDownload(params.id, payload.assignments))
      .handle("keep", ({ params }) => fixes.keep(params.id))
      .handle("letGo", ({ params }) => fixes.letGo(params.id))
      .handle("ignoreAndWait", ({ params, payload }) => fixes.ignoreAndWait(params.id, payload.days))
      .handle("releases", ({ params }) => fixes.releases(params.id))
      .handle("grab", ({ params, payload }) => fixes.grab(params.id, payload))
  }))

