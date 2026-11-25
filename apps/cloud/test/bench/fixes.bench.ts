import { test } from "vitest"
import { benchOptions, paths, realisticHome } from "./paths.ts"

test("To fix, on a big home", async ({ bench }) => {
  const home = realisticHome()
  await bench.compare(
    bench("movies without a source", () => void paths.moviesWithoutSource.run(home)),
    bench("episodes without a source", () => void paths.episodesWithoutSource.run(home)),
    bench("stuck removals", () => void paths.stuckRemovals.run(home)),
    bench("blocked imports", () => void paths.blockedImports.run(home)),
    benchOptions
  )
})
