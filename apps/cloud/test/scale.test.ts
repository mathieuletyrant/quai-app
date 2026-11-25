/**
 * Quai Cloud's pure computations stay linear in the home's size: each screen's, on the real home
 * copied over (`bigHome`, `bench/paths.ts`), at a base size and at 4 times it. Linear grows about 4
 * times, quadratic about 16: more than 8 fails. A lookup inside a loop goes through a Map or Set
 * built once. Absolute numbers: `pnpm bench` (test/bench).
 */
import { describe, expect, it } from "@effect/vitest"
import { type Path, paths } from "./bench/paths.ts"
import { type BigHome, bigHome, type Copies } from "./bigHome.ts"

/** The base home: the real one 100 times over (300 movies, 300 series, 200 torrents…). */
const defaultBase = 100
const scale = 4
const maxGrowth = 8
const runs = 7
/** A sample lasts at least this long at the base size (the path runs as many times as it takes): above the noise. */
const sampleMs = 5

/** Every service copied as many times. */
const evenly = (factor: number): Copies => ({
  radarr: factor,
  sonarr: factor,
  qbittorrent: factor,
  reclaimerr: factor,
  cleanuparr: factor
})

/** Four times as many torrents as the *arrs grabbed: most of them Quai can't place in the library. */
const unplacedTorrents = (factor: number): Copies => ({ ...evenly(factor), qbittorrent: 4 * factor })

const homes = new Map<string, BigHome>()
const homeOf = (copies: Copies) => {
  const key = JSON.stringify(copies)
  const known = homes.get(key) ?? bigHome(copies)
  homes.set(key, known)
  return known
}

let sink: unknown

const sample = (path: Path, input: unknown, times: number) => {
  const start = performance.now()
  for (let run = 0; run < times; run++) sink = path.run(input)
  return performance.now() - start
}

const median = (samples: ReadonlyArray<number>) =>
  [...samples].sort((left, right) => left - right)[samples.length >> 1]!

/** How many times longer the path takes on a home 4 times bigger: medians of samples taken in turn, after a warm-up. */
const growth = (path: Path, copiesOf: (factor: number) => Copies, base: number) => {
  const small = path.prepare(homeOf(copiesOf(base)))
  const large = path.prepare(homeOf(copiesOf(base * scale)))
  sample(path, large, 1)
  const times = Math.max(1, Math.ceil(sampleMs / sample(path, small, 1)))
  const smalls: Array<number> = []
  const larges: Array<number> = []
  for (let run = 0; run < runs; run++) {
    smalls.push(sample(path, small, times))
    larges.push(sample(path, large, times))
  }
  return median(larges) / median(smalls)
}

// Timing on a busy machine (the other test files run alongside) can be off once; quadratic is off every time.
const staysLinear = (name: string, path: Path, copiesOf = evenly, base = defaultBase) =>
  it(name, { retry: 2 }, () => {
    expect(growth(path, copiesOf, base)).toBeLessThan(maxGrowth)
    expect(sink).toBeDefined()
  })

describe("Quai Cloud stays linear in the home's size", () => {
  staysLinear("Upcoming's releases stay linear in the calendars' size", paths.releases)
  staysLinear("Reclaimerr's planned deletions find their posters in linear time", paths.plannedDeletions)
  staysLinear("Upcoming's space back stays linear in the torrents and the library", paths.spaceBack)
  staysLinear(
    "Upcoming's space back stays linear with torrents it can't place",
    paths.spaceBack,
    unplacedTorrents
  )
  staysLinear("Upcoming's seed cleanups stay linear in the torrents", paths.seedCleanups)
  staysLinear("Upcoming's whole list stays linear in the home's size", paths.upcoming)
  // A grab scanned per missing title costs little each time: it shows from a bigger home.
  staysLinear(
    "To fix's no-source rule for movies stays linear in the home's size",
    paths.moviesWithoutSource,
    evenly,
    400
  )
  staysLinear(
    "To fix's no-source rule for episodes stays linear in the home's size",
    paths.episodesWithoutSource,
    evenly,
    400
  )
  staysLinear("To fix's stuck removals stay linear in the strikes and the queues", paths.stuckRemovals)
  staysLinear("To fix's blocked imports stay linear in the queues", paths.blockedImports)
  staysLinear("The library stays linear in the movies and series", paths.library)
})
