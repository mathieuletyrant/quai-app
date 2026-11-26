// Renders each <section class="shot"> of index.html to out/<its id>.png, 1320 × 2868 (the App Store's iPhone 6.9").
// node apps/ios/AppStore/render.mjs            all of them
// node apps/ios/AppStore/render.mjs 03-upcoming   one
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Playwright from wherever it is installed (globally, or `npm i -g playwright`).
const { chromium } = createRequire(import.meta.url)("playwright")
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "out")
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(join(here, "index.html")).href)
await page.evaluate(() => document.fonts.ready)
const wanted = process.argv.slice(2)
for (const id of await page.$$eval(".shot", (shots) => shots.map((shot) => shot.id))) {
  if (wanted.length > 0 && !wanted.includes(id)) continue
  await page.locator(`[id="${id}"]`).screenshot({ path: join(out, `${id}.png`) })
  console.log(join(out, `${id}.png`))
}
await browser.close()
