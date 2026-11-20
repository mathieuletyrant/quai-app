import { describe, expect, it } from "@effect/vitest"
import { CurrentDevice, type DeviceId, InvalidAction, QuaiApi, type JournalEntry, journalId } from "@quai/api"
import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { generateKeyPairSync } from "node:crypto"
import { Devices } from "../src/home/Devices.ts"
import { HomeLink } from "../src/home/HomeLink.ts"
import { HomeReads } from "../src/home/HomeReads.ts"
import { Integrations } from "../src/integrations/Integration.ts"
import { torrentsWatchId } from "../src/integrations/qbittorrent.ts"
import { eventNote } from "../src/journal/describe.ts"
import { Journal, Timing } from "../src/journal/Journal.ts"
import { Apns } from "../src/push/Apns.ts"
import { cloud, cloudLive, makeFakeHome, recordedHome } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { fakeApns } from "./push/fakeApns.ts"
import { TestApp } from "./testApp.ts"

const keyPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString()

/** The Journal alone, on the real home link. */
const journalOnly = Journal.layer.pipe(Layer.provideMerge(HomeLink.layer))

/** The Cloud with no integration and no APNs key: its Hub hands the journal what Quai Home notes. */
const quietCloud = cloud(Layer.succeed(Integrations, [])).pipe(Layer.provide(Layer.effect(Apns, Apns.make(null))))

const texts = (entries: ReadonlyArray<JournalEntry>) => entries.map((e) => `${e.level} ${e.source} ${e.text}`)

describe("Cloud journal", () => {
  it.effect("hands Quai Home its lines in one batch, 1.5 s after the first", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const journal = yield* Journal
      yield* journal.log({ level: "info", source: "radarr", kind: "a", text: "one" })
      yield* TestClock.adjust(500)
      yield* journal.log({ level: "warn", source: "sonarr", kind: "b", text: "two" })
      const appends = () => home.received.filter((m) => m._tag === "JournalAppend")
      expect(appends()).toHaveLength(0)
      yield* TestClock.adjust(Timing.batchMs - 500)
      expect(appends()).toHaveLength(1)
      expect(texts(home.journal)).toEqual(["info radarr one", "warn sonarr two"])
      // Ids sort as the lines were written.
      expect(home.journal[0]!.id < home.journal[1]!.id).toBe(true)
    }).pipe(Effect.provide(journalOnly)))

  it.effect("keeps what's logged while Quai Home is offline, and hands it over once it's back", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      const journal = yield* Journal
      yield* journal.log({ level: "warn", source: "home", kind: "home.offline", text: "offline" })
      yield* TestClock.adjust(Timing.batchMs)
      expect(home.journal).toHaveLength(0)
      yield* home.connect
      yield* journal.log({ level: "info", source: "home", kind: "home.linked", text: "back" })
      yield* TestClock.adjust(Timing.batchMs)
      expect(texts(home.journal)).toEqual(["warn home offline", "info home back"])
    }).pipe(Effect.provide(journalOnly)))

  it.effect("reads the history from Quai Home, so a restarted Cloud has it all; a page is filtered there", () =>
    Effect.gen(function*() {
      const kept: Array<JournalEntry> = []
      // The first Cloud: logs, hands over, stops.
      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome()
        yield* home.connect
        const journal = yield* Journal
        yield* journal.log({ level: "info", source: "radarr", kind: "media.grabbed", text: "Radarr grabbed a release of Dune", subject: "movie:tmdb:1", title: "Dune" })
        yield* journal.log({ level: "error", source: "radarr", kind: "service.down", text: "Radarr hasn't answered for 5 minutes" })
        yield* TestClock.adjust(Timing.batchMs)
        kept.push(...home.journal)
      }).pipe(Effect.scoped, Effect.provide(journalOnly))

      // A new Cloud: nothing in memory, all of it at home.
      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome()
        home.journal.push(...kept)
        yield* home.connect
        const journal = yield* Journal
        expect((yield* journal.since(undefined)).entries).toEqual([])
        const page = yield* journal.history({ limit: 10 })
        expect(page.kept).toBe("home")
        expect(texts(page.entries)).toEqual(["error radarr Radarr hasn't answered for 5 minutes", "info radarr Radarr grabbed a release of Dune"])
        expect(texts((yield* journal.history({ limit: 10, subject: "movie:tmdb:1" })).entries)).toEqual(["info radarr Radarr grabbed a release of Dune"])
        // What waits goes first: a read sees a line logged just before.
        yield* journal.log({ level: "info", source: "cloud", kind: "x", text: "just now" })
        expect((yield* journal.history({ limit: 1 })).entries.map((e) => e.text)).toEqual(["just now"])
      }).pipe(Effect.scoped, Effect.provide(journalOnly))
    }))

  it.effect("a Home too old for a journal gets no journal message: the memory answers", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ protocol: 3 })
      yield* home.connect
      const journal = yield* Journal
      yield* journal.log({ level: "info", source: "radarr", kind: "a", text: "one" })
      yield* TestClock.adjust(Timing.batchMs)
      const page = yield* journal.history({ limit: 10 })
      expect(page).toMatchObject({ kept: "memory", more: false })
      expect(page.entries.map((e) => e.text)).toEqual(["one"])
      expect(home.received.some((m) => m._tag === "JournalAppend" || m._tag === "JournalRead")).toBe(false)
    }).pipe(Effect.provide(journalOnly)))

  it.effect("the live tail: what came after a cursor, Quai Home's own lines too; a cursor from another run starts over", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const journal = yield* Journal
      yield* journal.log({ level: "info", source: "cloud", kind: "a", text: "one" })
      const first = yield* journal.since(undefined)
      expect(first.entries.map((e) => e.text)).toEqual(["Quai Home linked (Radarr, Sonarr, qBittorrent, Jellyfin)", "one"])
      yield* home.note({ id: journalId(5, "h", 0), at: 5, level: "warn", source: "radarr", kind: "call.refused", text: "refused" })
      yield* journal.log({ level: "info", source: "cloud", kind: "b", text: "two" })
      const next = yield* journal.since(first.cursor)
      expect(next.entries.map((e) => e.text)).toEqual(["refused", "two"])
      expect((yield* journal.since(next.cursor)).entries).toEqual([])
      expect((yield* journal.since("0000.3")).entries).toHaveLength(4)
      // Quai Home's own line is already at home: not handed back.
      yield* TestClock.adjust(Timing.batchMs)
      expect(texts(home.journal)).toEqual(["warn radarr refused", "info home Quai Home linked (Radarr, Sonarr, qBittorrent, Jellyfin)", "info cloud one", "info cloud two"])
      // The memory holds the last 200.
      for (let i = 0; i < Timing.tail + 5; i++) yield* journal.log({ level: "info", source: "cloud", kind: "n", text: `n${i}` })
      expect((yield* journal.since(undefined)).entries).toHaveLength(Timing.tail)
    }).pipe(Effect.provide(quietCloud)))

  it.effect("an action is logged with how it went, and the iPhone that pressed it", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const journal = yield* Journal
      const note = { level: "info", source: "seerr", kind: "request.approve", text: "Approved Julie's request for Dune" } as const
      yield* journal.outcome(note, Effect.void).pipe(Effect.provideService(CurrentDevice, { id: "d1" as DeviceId, name: "Julie's iPhone" }))
      yield* Effect.flip(journal.outcome(note, Effect.fail(new InvalidAction({ message: "Seerr: HTTP 500" }))))
      const lines = (yield* journal.since(undefined)).entries
      expect(lines.map((e) => [e.level, e.kind, e.text, e.deviceName])).toEqual([
        ["info", "request.approve", "Approved Julie's request for Dune", "Julie's iPhone"],
        ["warn", "request.approve.failed", "Approved Julie's request for Dune: failed, Seerr: HTTP 500", undefined]
      ])
    }).pipe(Effect.provide(journalOnly)))

  it.effect("a service that stops answering the reads is logged once, and once when it's back; a 404 isn't", () =>
    Effect.gen(function*() {
      let up = false
      const home = yield* makeFakeHome({ services: ["radarr"], answer: recordedHome({ "radarr GET /api/v3/queue": () => up ? { json: [] } : { failed: "unreachable" } }) })
      yield* home.connect
      const reads = yield* HomeReads
      const journal = yield* Journal
      const queue = { service: "radarr" as const, path: "/api/v3/queue?apikey=never", schema: Schema.Array(Schema.Unknown) }
      yield* reads.read(queue)
      yield* reads.read(queue)
      yield* reads.read({ ...queue, path: "/api/v3/movie" })
      up = true
      yield* reads.read(queue)
      expect(texts((yield* journal.since(undefined)).entries)).toEqual([
        "warn radarr Radarr didn't answer Quai: unreachable (/api/v3/queue)",
        "info radarr Radarr answers Quai again"
      ])
    }).pipe(Effect.provide(HomeReads.layer.pipe(Layer.provideMerge(journalOnly)))))
})

describe("what the Cloud logs", () => {
  it.effect("Quai Home linked and gone, a webhook and what it meant, an activity's steps and its pushes, Apple's refusal", () =>
    Effect.gen(function*() {
      const apnsServer = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: apnsServer.url, production: apnsServer.url }
      )
      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome({ services: ["radarr", "qbittorrent", "jellyfin"] })
        yield* home.connect
        const devices = yield* Devices
        const journal = yield* Journal
        const paired: Array<DeviceId> = []
        for (const [name, token] of [["Mathieu's iPhone", "pts"], ["Julie's iPhone", "dead-julie"]] as const) {
          const { code } = yield* devices.createPairingCode
          const device = yield* devices.pair({ code, name, apnsEnvironment: "development", pushToStartToken: token })
          if (device._tag === "Some") paired.push(device.value.deviceId)
        }

        yield* home.webhook("radarr", { nope: true })
        yield* home.webhook("radarr", fixture("radarr/movie-added.json"))
        yield* devices.setActivityToken(paired[0]!, "download|movie:tmdb:693134", "act")
        yield* TestClock.adjust("3 minutes")
        yield* home.webhook("radarr", fixture("radarr/grab.json"))
        // The same grab again (a retried webhook) says nothing new.
        yield* home.webhook("radarr", fixture("radarr/grab.json"))
        yield* TestClock.adjust("15 seconds")
        // A progress changes numbers only: no line.
        yield* home.snapshot(torrentsWatchId, (fixture("qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
        yield* home.disconnect

        const lines = (yield* journal.since(undefined)).entries
        expect(texts(lines)).toEqual([
          "info home Quai Home linked (Radarr, qBittorrent, Jellyfin)",
          "warn radarr Radarr sent a webhook Quai can't read",
          "info radarr Dune: Part Two added to Radarr",
          "warn apple Apple refused the push to Julie's iPhone: Unregistered (its token is gone: dropped)",
          "info cloud Download: Dune: Part Two started, “Searching” · pushed to 1 iPhone",
          "info radarr Radarr grabbed a release of Dune: Part Two",
          "info cloud Download: Dune: Part Two is now “Downloading” · pushed to 1 iPhone",
          "warn home Quai Home went offline: nothing can be read or pushed until it's back"
        ])
        const added = lines[2]!
        expect(added).toMatchObject({ kind: "media.added", subject: "movie:tmdb:693134", title: "Dune: Part Two" })
        expect(lines[3]).toMatchObject({ kind: "push.refused", deviceName: "Julie's iPhone", flowId: "download" })
        // Never a token.
        expect(JSON.stringify(lines)).not.toMatch(/dead-julie|"pts"/)

        // Everything but the last line reached Quai Home before it dropped.
        expect(home.journal.map((e) => e.text)).toEqual(lines.slice(0, -1).map((e) => e.text))
      }).pipe(Effect.provide(cloudLive.pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }))
})

describe("journal routes", () => {
  it.effect("history pages with filters from Quai Home, the live tail after a cursor; both answer while Quai Home is offline", () =>
    Effect.gen(function*() {
      const client = (yield* HttpApiTest.groups(QuaiApi, ["consoleJournal"])).consoleJournal
      const journal = yield* Journal

      // Offline: the memory answers, nothing is a 503.
      yield* journal.log({ level: "warn", source: "home", kind: "home.offline", text: "offline" })
      expect(yield* client.history({ query: {} })).toMatchObject({ kept: "memory", more: false })

      const home = yield* makeFakeHome()
      home.journal.push(
        { id: journalId(20_001, "c", 0), at: 20_001, level: "info", source: "radarr", kind: "media.grabbed", text: "Radarr grabbed a release of Dune", subject: "movie:tmdb:1", title: "Dune" },
        { id: journalId(20_002, "h", 0), at: 20_002, level: "warn", source: "sonarr", kind: "call.refused", text: "refused" },
        { id: journalId(20_003, "c", 1), at: 20_003, level: "error", source: "apple", kind: "push.refused", text: "Apple refused the push" }
      )
      yield* home.connect

      const all = yield* client.history({ query: { limit: 2 } })
      expect(all.kept).toBe("home")
      expect(all.more).toBe(true)
      const older = yield* client.history({ query: { limit: 2, before: all.entries.at(-1)!.id } })
      // Then Radarr's, and the Cloud's own lines from before (at 0, handed over when Quai Home linked).
      expect(older.entries.map((e) => e.source)).toEqual(["radarr", "home"])
      expect((yield* client.history({ query: { source: "radarr,apple,nope", level: "error" } })).entries.map((e) => e.source)).toEqual(["apple"])
      expect((yield* client.history({ query: { subject: "movie:tmdb:1" } })).entries.map((e) => e.title)).toEqual(["Dune"])
      expect((yield* client.history({ query: { search: "REFUSED" } })).entries).toHaveLength(2)

      const tail = yield* client.since({ query: {} })
      expect(tail.entries.map((e) => e.text)).toEqual(["offline", "Quai Home linked (Radarr, Sonarr, qBittorrent, Jellyfin)"])
      yield* journal.log({ level: "info", source: "cloud", kind: "x", text: "next" })
      expect((yield* client.since({ query: { cursor: tail.cursor } })).entries.map((e) => e.text)).toEqual(["next"])
    }).pipe(Effect.provide(TestApp)))
})

describe("what an event means", () => {
  it("one plain line per step event, none for the data events", () => {
    const request = { kind: "request" as const, key: "request:12", title: "Paddington in Peru", mediaType: "movie" as const, requester: "Julie" }
    const tv = { kind: "playback" as const, key: "playback:s:i", title: "Dune", device: "Living room TV" }
    const radarr = { kind: "service" as const, key: "service:radarr", title: "Radarr" }
    expect(eventNote({ type: "request.pending", subject: request }, "seerr")).toMatchObject({
      source: "seerr",
      text: "Julie asked for Paddington in Peru: waiting for approval",
      subject: "request:12",
      title: "Paddington in Peru"
    })
    expect(eventNote({ type: "playback.started", subject: tv }, "jellyfin")?.text).toBe("Dune started playing on Living room TV")
    expect(eventNote({ type: "service.down", subject: radarr }, "quai")).toMatchObject({ level: "error", source: "radarr", text: "Radarr hasn't answered for 5 minutes" })
    expect(eventNote({ type: "service.down", subject: radarr }, "quai")).not.toHaveProperty("subject")
    expect(eventNote({ type: "playback.progress", subject: tv }, "jellyfin")).toBeNull()
    expect(eventNote({ type: "download.progress", downloadId: "h" }, "qbittorrent")).toBeNull()
  })
})
