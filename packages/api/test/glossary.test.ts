import { describe, expect, it } from "@effect/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The glossary's words, everywhere: code, UI text and the wire values don't use a word
 * GLOSSARY.md lists under `_Avoid_`. The words come from GLOSSARY.md, so a new `_Avoid_` word is
 * checked as soon as it is written, unless it is skipped below, with why.
 */

const root = join(import.meta.dirname, "..", "..", "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")

interface Avoided {
  /** The glossary term to use instead. */
  readonly term: string
  /** The `_Avoid_` entry as written, parenthesis and leading "the" dropped. */
  readonly word: string
}

/** Each `**Term**` and the words of its `_Avoid_:` line, up to its first sentence's end. */
const avoidedWords = (glossary: string): ReadonlyArray<Avoided> => {
  const found: Array<Avoided> = []
  let term = ""
  for (const line of glossary.split("\n")) {
    const heading = /^\*\*(.+?)\*\*/.exec(line)
    if (heading !== null) term = heading[1] ?? ""
    const avoid = /^_Avoid_:\s*(.+)$/.exec(line)
    if (avoid === null) continue
    const list = (avoid[1] ?? "").split(/\.\s/)[0] ?? ""
    for (const entry of list.split(",")) {
      const word = entry.replace(/\([^)]*\)/g, "").replace(/\.$/, "").trim().replace(/^the\s+/, "")
      if (word !== "") found.push({ term, word })
    }
  }
  return found
}

/**
 * Avoided words not checked, with why: a plain English word the code needs in another sense, a
 * service's own name for something, or an entry wrong in one sense only, which a match can't see.
 */
const skipped: Readonly<Record<string, string>> = {
  account: "plain English (an Apple account, Seerr's users' accounts)",
  server: "Quai Home and Quai Cloud are both servers; only wrong when it could be either",
  "\"home\" alone for the server": "wrong in one sense only: the home is also the household",
  agent: "Seerr's and Reclaimerr's own name for their notification channels (webhook agent)",
  app: "plain English: the iPhone app, a service's own app",
  integration: "a glossary term itself: the Cloud's module for a service",
  admin: "Seerr's admin user, as the glossary's Requester says",
  "device in UI text": "wrong in UI text only: the code says device, and a Jellyfin device is one",
  client: "the download client, an HTTP client, the generated iOS client",
  phone: "inside iPhone, the glossary's own word",
  rule: "the allowlist's rules (`allowRule`) and To fix's fixed rules",
  intent: "Apple's App Intents, what a Live Activity button runs",
  command: "the *arr's own commands (`/api/v3/command`)",
  media: "the media subject, Radarr's and Sonarr's media; only wrong in words people read",
  item: "plain English, a list's items; only wrong in words people read",
  torrent: "qBittorrent's side, where a download is a torrent",
  result: "plain English (an Effect's result, a search's results)",
  "\"release\" alone": "wrong in one sense only: a release is also what an indexer offers",
  airing: "the verb is fine (an episode airing, as the glossary says); only the noun is avoided",
  log: "Effect's logging, the server's log lines",
  history: "the *arr's own history (`/api/v3/history`)",
  warning: "the *arr's import warnings, as the glossary's Import blocked says",
  problem: "plain English (the *arr's health problems, a header's problem)",
  issue: "plain English",
  deletion: "inside planned deletion, the glossary's own term, and what Reclaimerr does",
  candidate: "Reclaimerr's own name for a title it plans to delete (`/api/v1/candidates`), and a variable name",
  strike: "Cleanuparr's own counter, as the glossary's Stuck removal says",
  "stuck removal": "a glossary term itself; which cleaner it names isn't in the words"
}

/** Where code and UI text live: the TypeScript of every app and the contract, and the iOS app's Swift. */
const sourceDirs = [
  "apps/cloud/src",
  "apps/home/src",
  "apps/console/src",
  "packages/api/src",
  "apps/ios/Quai",
  "apps/ios/QuaiWidgets",
  "apps/ios/Shared"
]
const sourceFile = /\.(?:ts|tsx|swift)$/
const filesOf = (dir: string): ReadonlyArray<string> =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return entry.name === "Generated" || entry.name === "node_modules" ? [] : filesOf(path)
    return sourceFile.test(entry.name) ? [path] : []
  })
/** The sources, and the contract's wire values. */
const scanned = [...sourceDirs.flatMap(filesOf), "packages/api/openapi.json"]

interface Allowed {
  readonly word: string
  readonly files: RegExp
  /** The lines the word may be on; any line of the files when absent. */
  readonly line?: RegExp
  readonly reason: string
}

/** Avoided words in another sense than the glossary's, where they are. Each one must still be found. */
const otherSenses: ReadonlyArray<Allowed> = [
  {
    word: "snooze",
    files: /^apps\/cloud\/src\/fixes\/Fixes\.ts$/,
    line: /fixes\/snoozed/,
    reason: "the stored path of fixes ignored for now: older than the name, kept so hidden fixes stay hidden"
  },
  {
    word: "dismiss",
    files: /^apps\/cloud\/src\/fixes\/Fixes\.ts$/,
    line: /fixes\/dismissed/,
    reason: "the stored path of fixes let go: older than the name, kept so hidden fixes stay hidden"
  },
  {
    word: "dismiss",
    files: /^apps\/cloud\/src\/(?:flows\/Targeting|home\/Devices|push\/Notifier|push\/ApnsPayload)\.ts$/,
    reason: "a Live Activity the iPhone dismissed (swiped away), and APNs' `dismissal-date`"
  },
  {
    word: "dismiss",
    files: /\.swift$/,
    line: /@Environment\(\\\.dismiss\)|\bdismiss\(\)|scrollDismissesKeyboard|onDismiss:|== \.dismissed\b/,
    reason: "SwiftUI closing a sheet or the keyboard, ActivityKit's `.dismissed` Live Activity"
  },
  {
    word: "dismiss",
    files: /^apps\/console\/src\/ui\/feedback\.tsx$/,
    line: /until dismissed|aria-label="Dismiss"/,
    reason: "closing the console's toast"
  },
  {
    word: "dashboard",
    files: /^apps\/console\/src\/pages\/Services\.tsx$/,
    line: /Dashboard → API Keys/,
    reason: "Jellyfin's own menu, where its API key is"
  },
  {
    word: "subscription",
    files: /^apps\/home\/src\/ServiceSettings\.ts$/,
    line: /PubSub\.Subscription/,
    reason: "Effect's `PubSub.Subscription`"
  },
  {
    word: "backend",
    files: /^apps\/cloud\/src\/integrations\/reclaimerr\.ts$/,
    line: /backend\/models/,
    reason: "a path in Reclaimerr's source"
  },
  {
    word: "queue item",
    files: /^apps\/cloud\/src\/integrations\/cleanuparr\.ts$/,
    line: /QueueItemDeleted/,
    reason: "Cleanuparr's own event, as the glossary's Event says"
  }
]

/**
 * Hits in apps/ios not renamed yet: the iOS app is being changed elsewhere. Each one must still be
 * found, so the entry goes once the code says the glossary's word.
 */
const toRename: ReadonlyArray<Allowed> = [
  {
    word: "incident",
    files: /^apps\/ios\/(?:Quai|Shared)\/.+\.swift$/,
    line: /Palette\.incident|static let incident/,
    reason: "the palette's red for alerts and failures: rename `Palette.incident` (to `Palette.alert`)"
  },
  {
    word: "freed space",
    files: /^apps\/ios\/Quai\/Views\/UpcomingView\.swift$/,
    line: /some freed space is unknown/,
    reason: "UI text: say the space back (\"some space back is unknown\")"
  }
]

/**
 * The word as code and text write it: "scheduled deletion", `scheduledDeletion`,
 * `ScheduledDeletion`, `SCHEDULED_DELETION`, with any ending (snoozed, dismissal). It starts a word
 * or a camelCase part: `isSnoozed` matches, `undismissable` doesn't.
 */
const matcher = (word: string) => {
  const pattern = new RegExp(
    word.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]?"),
    "gi"
  )
  return (line: string): boolean =>
    [...line.matchAll(pattern)].some((match) => {
      const before = line[match.index - 1] ?? ""
      const first = match[0][0] ?? ""
      return !/[A-Za-z]/.test(before) || (/[a-z0-9]/.test(before) && first === first.toUpperCase())
    })
}

interface Hit {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly avoided: Avoided
}

const allows = (allowed: Allowed, hit: Hit) =>
  allowed.word === hit.avoided.word && allowed.files.test(hit.file) && (allowed.line?.test(hit.text) ?? true)

const glossary = avoidedWords(read("GLOSSARY.md"))
const checked = glossary.filter(({ word }) => skipped[word] === undefined)
const hits: ReadonlyArray<Hit> = scanned.flatMap((file) =>
  read(file).split("\n").flatMap((text, index) =>
    checked.filter(({ word }) => matcher(word)(text)).map((avoided) => ({ file, line: index + 1, text, avoided }))
  )
)

describe("glossary", () => {
  it("reads the avoided words of GLOSSARY.md", () => {
    expect(glossary).toContainEqual({ term: "Ignore and wait", word: "snooze" })
    expect(glossary).toContainEqual({ term: "Planned deletion", word: "scheduled deletion" })
    expect(glossary).toContainEqual({ term: "Quai Cloud", word: "backend" })
    expect(glossary).toContainEqual({ term: "Release", word: "torrent" })
    expect(glossary.map(({ word }) => word)).not.toContain("A Jellyfin *device*")
  })

  it("skips only words GLOSSARY.md still avoids", () => {
    const words = new Set(glossary.map(({ word }) => word))
    expect(Object.keys(skipped).filter((word) => !words.has(word))).toEqual([])
  })

  it("matches the word as code and text write it", () => {
    const scheduled = matcher("scheduled deletion")
    expect(
      ["a scheduled deletion", "Scheduled deletion", "scheduledDeletion", "isScheduledDeletion", "SCHEDULED_DELETION"]
        .every(scheduled)
    ).toBe(true)
    const snooze = matcher("snooze")
    expect(["snoozed", "isSnoozed", "\"snooze\"", "Snooze for 3 days"].every(snooze)).toBe(true)
    expect(["unsnoozable", "plannedDeletion"].some(snooze)).toBe(false)
  })

  it("finds every allowed hit still in the code", () => {
    const stale = [...otherSenses, ...toRename].filter((allowed) => !hits.some((hit) => allows(allowed, hit)))
    expect(stale.map(({ word, reason }) => `${word}: ${reason}`)).toEqual([])
  })

  it("uses the glossary's words in code, UI text and wire values", () => {
    const found = hits
      .filter((hit) => ![...otherSenses, ...toRename].some((allowed) => allows(allowed, hit)))
      .map(({ avoided, file, line, text }) =>
        `${file}:${line}: "${avoided.word}" → say ${avoided.term} (GLOSSARY.md): ${text.trim()}`
      )
    expect(found).toEqual([])
  })
})
