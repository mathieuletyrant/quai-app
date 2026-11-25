import { test } from "vitest"
import { benchOptions, paths, realisticHome } from "./paths.ts"

test("Library, on a big home", async ({ bench }) => {
  const home = realisticHome()
  await bench("every movie and series, newest first", () => void paths.library.run(home)).run(benchOptions)
})
