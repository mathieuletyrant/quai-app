// Renders each <section class="shot"> of index.html to a PNG per App Store display size:
// out/6.9/<id>.png (1320 × 2868, the page's own size) and out/6.5/<id>.png (1284 × 2778).
// node apps/ios/AppStore/render.mjs            all of them
// node apps/ios/AppStore/render.mjs 04-upcoming   one
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Playwright from wherever it is installed (globally, or `npm i -g playwright`).
const { chromium } = createRequire(import.meta.url)("playwright")
const here = dirname(fileURLToPath(import.meta.url))

// The 6.5" screen is a little wider than the 6.9" one: scaled to its width, the shot is cut a few pixels at the bottom.
const sizes = [
  { name: "6.9", width: 1320, height: 2868 },
  { name: "6.5", width: 1284, height: 2778 }
]
const wanted = process.argv.slice(2)
const browser = await chromium.launch()
for (const size of sizes) {
  const scale = size.width / 1320
  const page = await browser.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: scale })
  await page.goto(pathToFileURL(join(here, "index.html")).href)
  await page.evaluate(() => document.fonts.ready)
  const out = join(here, "out", size.name)
  mkdirSync(out, { recursive: true })
  for (const id of await page.$$eval(".shot", (shots) => shots.map((shot) => shot.id))) {
    if (wanted.length > 0 && !wanted.includes(id)) continue
    const box = await page.locator(`[id="${id}"]`).boundingBox()
    await page.screenshot({
      path: join(out, `${id}.png`),
      clip: { x: box.x, y: box.y, width: 1320, height: size.height / scale },
      fullPage: true
    })
    console.log(join(out, `${id}.png`))
  }
  await page.close()
}
await browser.close()
