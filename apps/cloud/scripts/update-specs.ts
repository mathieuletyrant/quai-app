/**
 * Brings the services' OpenAPI specs in `test/fixtures/specs` to their latest release, or to the
 * tags given (`pnpm specs:update radarr=v7.0.3.10918`). `test/specs.test.ts` then checks Quai's
 * schemas against them. The weekly `specs` workflow runs it and opens a PR when a spec changed.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** Where each service keeps the spec it generates, in its own repository. */
const sources = {
  radarr: { repo: "Radarr/Radarr", file: "src/Radarr.Api.V3/openapi.json" },
  sonarr: { repo: "Sonarr/Sonarr", file: "src/Sonarr.Api.V3/openapi.json" }
} as const
type SpecService = keyof typeof sources

const directory = new URL("../test/fixtures/specs/", import.meta.url)
const versionsFile = fileURLToPath(new URL("versions.json", directory))

const isSpecService = (name: string): name is SpecService => Object.hasOwn(sources, name)

const requested = (argv: ReadonlyArray<string>): Partial<Record<SpecService, string>> =>
  Object.fromEntries(argv.map((argument) => {
    const [name = "", tag] = argument.split("=")
    if (!isSpecService(name) || tag === undefined) throw new Error(`Expected <service>=<tag>, got ${argument}`)
    return [name, tag]
  }))

const get = async (url: string, headers: Record<string, string> = {}): Promise<Response> => {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

// The latest release, not the latest tag: the *arrs tag every develop build.
const latestRelease = async (repo: string): Promise<string> => {
  const token = process.env["GITHUB_TOKEN"]
  const response = await get(`https://api.github.com/repos/${repo}/releases/latest`, {
    accept: "application/vnd.github+json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
  })
  const { tag_name } = await response.json() as { tag_name: string }
  return tag_name
}

const tags = requested(process.argv.slice(2))
const versions = JSON.parse(readFileSync(versionsFile, "utf8")) as Record<SpecService, string>
for (const [service, source] of Object.entries(sources) as ReadonlyArray<[SpecService, typeof sources[SpecService]]>) {
  const tag = tags[service] ?? await latestRelease(source.repo)
  const spec = await get(`https://raw.githubusercontent.com/${source.repo}/${tag}/${source.file}`)
  // Re-indented so a new version's diff shows the fields that changed, line by line.
  writeFileSync(fileURLToPath(new URL(`${service}.json`, directory)), `${JSON.stringify(await spec.json(), null, 2)}\n`)
  console.log(`${service}: ${versions[service]} → ${tag}`)
  versions[service] = tag
}
writeFileSync(versionsFile, `${JSON.stringify(versions, null, 2)}\n`)
