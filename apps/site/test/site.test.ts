import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "..", "public")
const pages = readdirSync(root).filter((file) => file.endsWith(".html"))
const read = (page: string) => readFileSync(join(root, page), "utf8")
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
const sourcesOf = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourcesOf(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []
  )
const links = (html: string) => [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? "")

describe("site", () => {
  it("has the landing, the privacy policy and the support page", () => {
    expect(pages.sort()).toEqual(["index.html", "privacy.html", "support.html"])
  })

  describe.each(pages)("%s", (page) => {
    const html = read(page)

    it("is a standalone page for phones and desktops", () => {
      expect(html).toMatch(/<meta name="viewport" content="width=device-width/)
      expect(html).toMatch(/<title>[^<]+<\/title>/)
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/)
      expect(html).toContain("<html lang=\"en\">")
    })

    it("keeps nothing of the design canvas", () => {
      expect(html).not.toMatch(/\.dc\.html|\{\{|<sc-|<x-dc|<helmet|support\.js/)
    })

    it("loads nothing from another site but Cloudflare's visit counter", () => {
      for (const tag of html.match(/<(?:script|link|img)\b[^>]*>/g) ?? []) {
        if (tag.includes("src=\"https://static.cloudflareinsights.com/beacon.min.js\"")) continue
        expect(tag).not.toMatch(/(?:src|href)="(?:https?:)?\/\//)
      }
    })

    it("sends to the App Store first, and offers Safari's App Store banner", () => {
      expect(html).toContain("<meta name=\"apple-itunes-app\" content=\"app-id=6836390669\">")
      const store = html.indexOf("href=\"https://apps.apple.com/app/id6836390669\"")
      const beta = html.indexOf("href=\"https://testflight.apple.com/")
      expect(store).toBeGreaterThan(-1)
      if (beta > -1) expect(store).toBeLessThan(beta)
    })

    it("counts its visits with Cloudflare Web Analytics", () => {
      expect(html).toContain("src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon=")
    })

    it("links only to files and anchors that exist", () => {
      for (const link of links(html)) {
        if (/^(?:https?:|mailto:)/.test(link)) continue
        const [path, anchor] = link.split("#")
        const target = !path ? page : path === "./" ? "index.html" : path
        expect(existsSync(join(root, target)), `${page} → ${link}`).toBe(true)
        if (anchor) expect(ids(read(target)).has(anchor), `${page} → ${link}`).toBe(true)
      }
    })
  })

  it("describes Quai for LLMs in llms.txt, with no placeholder left", () => {
    const text = read("llms.txt")
    expect(text.startsWith("# Quai\n")).toBe(true)
    expect(text).toContain("wss://cloud.quai.stream/home")
    expect(text).not.toMatch(/YOUR-CODE|\[[A-Z][A-Z :]+\]/)
  })

  it("documents in llms.txt every QUAI_* variable Quai Home and Quai Cloud read", () => {
    const text = read("llms.txt")
    const repo = join(import.meta.dirname, "..", "..", "..")
    // The domain is what both run for a home: its variables are theirs.
    const sources = ["apps/home", "apps/cloud", "packages/domain"].flatMap((dir) => sourcesOf(join(repo, dir, "src")))
    const variables = new Set(
      sources.flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/"(QUAI_[A-Z_]+)"/g)].map((match) => match[1] ?? "")
      )
    )
    variables.delete("QUAI_CONSOLE_DIR") // set by the Dockerfile, never by the user
    expect([...variables].filter((name) => !text.includes(name))).toEqual([])
  })
})
