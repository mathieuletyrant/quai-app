import { test } from "vitest"
import { benchOptions, paths, realisticHome } from "./paths.ts"

test("Upcoming, on a big home", async ({ bench }) => {
  const home = realisticHome()
  const releases = paths.releases.prepare(home)
  const spaceReads = paths.spaceBack.prepare(home)
  const gathered = paths.upcoming.prepare(home)
  await bench.compare(
    bench("releases (14 days)", () => void paths.releases.run(releases)),
    bench("planned deletions with posters", () => void paths.plannedDeletions.run(home)),
    bench("space back", () => void paths.spaceBack.run(spaceReads)),
    bench("seed cleanups", () => void paths.seedCleanups.run(home)),
    bench("the whole list (upcomingOf)", () => void paths.upcoming.run(gathered)),
    benchOptions
  )
})
