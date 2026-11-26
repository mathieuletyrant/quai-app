/**
 * Brings the services' OpenAPI specs in `test/fixtures/specs` to their latest release, or to the
 * versions given (`pnpm specs:update radarr=v7.0.3.10918 jellyfin=12.4`). `test/specs.test.ts` then
 * checks Quai's schemas against them. The weekly `specs` workflow runs it and opens a PR when one changed.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { kept, type Spec } from "./keptPaths.ts"

interface Source {
  /** The version of the latest release. */
  readonly latest: () => Promise<string>
  /** The spec's URL at a version. */
  readonly url: (version: string) => string
  /** The paths kept, with what they reference: the others are left out of a spec too big to commit whole. */
  readonly paths?: ReadonlyArray<string>
}

const get = async (url: string, headers: Record<string, string> = {}): Promise<Response> => {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

// The latest release, not the latest tag: the *arrs tag every develop build.
const latestRelease = (repo: string) => async (): Promise<string> => {
  const token = process.env["GITHUB_TOKEN"]
  const response = await get(`https://api.github.com/repos/${repo}/releases/latest`, {
    accept: "application/vnd.github+json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
  })
  const { tag_name } = await response.json() as { tag_name: string }
  return tag_name
}

/** A spec the service commits in its repository, at each release's tag. */
const inRepository = (repo: string, file: string): Source => ({
  latest: latestRelease(repo),
  url: (tag) => `https://raw.githubusercontent.com/${repo}/${tag}/${file}`
})

// Jellyfin doesn't commit its spec: its project publishes one per release on api.jellyfin.org.
const jellyfinSpecs = "https://api.jellyfin.org/openapi"

const sources: Record<string, Source> = {
  radarr: inRepository("Radarr/Radarr", "src/Radarr.Api.V3/openapi.json"),
  sonarr: inRepository("Sonarr/Sonarr", "src/Sonarr.Api.V3/openapi.json"),
  prowlarr: inRepository("Prowlarr/Prowlarr", "src/Prowlarr.Api.V1/openapi.json"),
  seerr: inRepository("seerr-team/seerr", "seerr-api.yml"),
  jellyfin: {
    latest: async () => {
      const stable = await (await get(`${jellyfinSpecs}/jellyfin-openapi-stable.json`)).json() as {
        info: { "x-jellyfin-version": string }
      }
      // 12.4.0 is published as 12.4.
      return stable.info["x-jellyfin-version"].replace(/\.0$/, "")
    },
    url: (version) => `${jellyfinSpecs}/stable/jellyfin-openapi-${version}.json`,
    paths: ["/Items", "/Users", "/Sessions"]
  }
}

const directory = new URL("../test/fixtures/specs/", import.meta.url)
const versionsFile = fileURLToPath(new URL("versions.json", directory))

const requested = (argv: ReadonlyArray<string>): Record<string, string> =>
  Object.fromEntries(argv.map((argument) => {
    const [name = "", version] = argument.split("=")
    if (!Object.hasOwn(sources, name) || version === undefined) {
      throw new Error(`Expected <service>=<version>, got ${argument}`)
    }
    return [name, version]
  }))

const asked = requested(process.argv.slice(2))
const versions = JSON.parse(readFileSync(versionsFile, "utf8")) as Record<string, string>
for (const [service, source] of Object.entries(sources)) {
  const version = asked[service] ?? await source.latest()
  // YAML (Seerr's) is read as JSON is: the test only reads JSON.
  const spec = parse(await (await get(source.url(version))).text()) as Spec
  const written = source.paths === undefined ? spec : kept(spec, source.paths)
  // Indented so a new version's diff shows the fields that changed, line by line.
  writeFileSync(fileURLToPath(new URL(`${service}.json`, directory)), `${JSON.stringify(written, null, 2)}\n`)
  console.log(`${service}: ${versions[service] ?? "none"} → ${version}`)
  versions[service] = version
}
writeFileSync(versionsFile, `${JSON.stringify(versions, null, 2)}\n`)
