import { describe, expect, it } from "@effect/vitest"
import type { DeviceId, GoneKind } from "@quai/api"
import { goneItem, goneTitle, isFresh, sizeText, spaceBackText } from "@quai/domain/gone/Gone.ts"
import { Devices } from "@quai/domain/home/Devices.ts"
import { HomeDocuments } from "@quai/domain/home/HomeLink.ts"
import { IntegrationsLive } from "@quai/domain/integrations/All.ts"
import {
  cleanedGone,
  cleanedNote,
  cleanedRead,
  cleanedWatchId,
  removalGone,
  removalsRead,
  removalsWatchId
} from "@quai/domain/integrations/cleanuparr.ts"
import { unseenSince } from "@quai/domain/integrations/EventFeed.ts"
import { Hub } from "@quai/domain/integrations/Hub.ts"
import {
  carriedOutDetail,
  carriedOutNote,
  deletionsWatchId,
  fileEventsWatchId
} from "@quai/domain/integrations/plannedDeletionAlert.ts"
import { carriedOut, type FileEvent, fileEventsRead, fileEventTitle } from "@quai/domain/integrations/reclaimerr.ts"
import { Journal } from "@quai/domain/journal/Journal.ts"
import { Apns } from "@quai/domain/push/Apns.ts"
import { DiskReadings } from "@quai/domain/storage/DiskReadings.ts"
import { Effect, Layer, Redacted, Schema } from "effect"
import { TestClock } from "effect/testing"
import { generateKeyPairSync } from "node:crypto"
import { makeApns } from "../src/push/ApnsClient.ts"
import { cloud, makeFakeHome, recordedHome, type Recording } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { fakeApns } from "./push/fakeApns.ts"

const keyPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString()

/** Ten past ten on the day Reclaimerr deleted the fixture's two titles, a few seconds after its run. */
const now = Date.parse("2026-11-25T10:10:00Z")

const deletedPage = () => fixture("reclaimerr/events-deleted.json") as { items: Array<FileEvent> }
const [severance, up] = deletedPage().items as [FileEvent, FileEvent]

describe("gone: the words", () => {
  it("a size in decimal units, like the iPhone's; space back only when some surely came back", () => {
    expect(sizeText(24_491_050_987)).toBe("24 GB")
    expect(sizeText(1_234_000_000_000)).toBe("1.2 TB")
    expect(sizeText(650_000_000)).toBe("650 MB")
    expect(sizeText(1000)).toBe("1 MB")
    expect(spaceBackText(24_491_050_987)).toBe(" · 24 GB back")
    expect(spaceBackText(undefined)).toBe("")
    expect(spaceBackText(0)).toBe("")
  })

  it("notified within the hour it happened, the journal only after", () => {
    expect(isFresh({ at: now - 3600_000 }, now)).toBe(true)
    expect(isFresh({ at: now - 3600_001 }, now)).toBe(false)
    expect(goneTitle({ title: "Vampire Diaries S07" })).toBe("Vampire Diaries S07 is gone")
  })

  it("a Reclaimerr event's title: a season or an episode after its series", () => {
    expect(fileEventTitle(severance)).toBe("Severance S01")
    expect(fileEventTitle(up)).toBe("Up")
    expect(fileEventTitle({ ...severance, payload: { ...severance.payload, episode_number: 4 } })).toBe(
      "Severance S01E04"
    )
    expect(fileEventTitle({ ...up, payload: {} })).toBe("A title")
  })

  it("what Reclaimerr did, and the space back when sure", () => {
    expect(carriedOutDetail(up, 24_491_050_987)).toBe("Deleted by Reclaimerr · 24 GB back")
    expect(carriedOutDetail({ ...up, type: "candidate.moved" }, undefined)).toBe("Moved by Reclaimerr")
    expect(carriedOutNote("Up", up, undefined)).toEqual({
      level: "info",
      source: "reclaimerr",
      kind: "reclaimerr.deleted",
      text: "Reclaimerr deleted Up",
      title: "Up"
    })
    expect(carriedOutNote("Up", { ...up, type: "candidate.moved" }, undefined).kind).toBe("reclaimerr.moved")
  })

  it("the candidate carried out: as Reclaimerr last listed it, else from the event, due now", () => {
    const listed = (fixture("reclaimerr/candidates.json") as { items: Array<{ id: number }> }).items[0] as never
    expect(carriedOut(up, listed, now)).toMatchObject({ candidate: listed, deletesAt: now / 1000, operation: "delete" })
    expect(carriedOut(severance, undefined, now)).toMatchObject({
      candidate: { id: 47, media_type: "series", title: "Severance S01", tmdb_id: 95396, scope: "season" },
      operation: "delete"
    })
    expect(carriedOut({ ...up, type: "candidate.moved" }, undefined, now).operation).toBe("move")
  })

  it("Reclaimerr's feed is read from the start of the hour before: the path changes once an hour", () => {
    expect(fileEventsRead("candidate.deleted", now).path).toBe(
      "/api/v1/events?event_type=candidate.deleted&limit=200&occurred_after=2026-11-25T09%3A00%3A00.000Z"
    )
    expect(fileEventsRead("candidate.deleted", now + 40 * 60_000).path).toBe(
      fileEventsRead("candidate.deleted", now).path
    )
  })

  it("Cleanuparr's removals and seed cleanups, in words", () => {
    const [removal] = Schema.decodeUnknownSync(removalsRead.schema)(fixture("cleanuparr/events-removed.json")).items
    expect(removalGone(removal!, now)).toEqual(goneItem({
      kind: "stuckRemoval",
      source: "cleanuparr",
      at: now,
      title: removal!.itemTitle!,
      detail: "Cleanuparr took it out of the queue: its import kept failing"
    }))
    const [cleaned] = Schema.decodeUnknownSync(cleanedRead.schema)(fixture("cleanuparr/events-cleaned.json")).items
    expect(cleanedNote(cleaned!).text).toBe(
      "Cleanuparr took Fool.Night.S01.1080p.WEB-DL-GRP out of qBittorrent after seeding (ratio 2.1, 14 days)"
    )
    expect(cleanedNote({ ...cleaned!, seedRatio: null, seedingTimeHours: 30 }).text).toBe(
      "Cleanuparr took Fool.Night.S01.1080p.WEB-DL-GRP out of qBittorrent after seeding (30 hours)"
    )
    expect(cleanedGone(cleaned!, now).detail).toBe("Cleanuparr took it out of qBittorrent after seeding")
  })

  it("a feed's events: newer than the last taken, each once, oldest first", () => {
    const events = [{ id: "b", at: 30 }, { id: "a", at: 20 }, { id: "c", at: 10 }]
    expect(unseenSince(events, 15, new Set()).map((event) => event.id)).toEqual(["a", "b"])
    expect(unseenSince(events, 0, new Set(["a", "b", "c"]))).toEqual([])
  })
})

describe("gone: who wants it", () => {
  it.effect("off until an iPhone turns a kind on; only iPhones that allowed notifications count", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const devices = yield* Devices
      const julie = yield* paired("Julie", "note-julie")
      const mathieu = yield* paired("Mathieu", undefined)
      expect(yield* devices.goneWanted).toEqual([])
      expect(yield* devices.goneRecipients("plannedDeletion")).toEqual([])

      yield* devices.setPreferences(mathieu, { flows: {}, gone: ["plannedDeletion"] })
      // No notification token yet: nothing to send to.
      expect(yield* devices.goneWanted).toEqual([])

      yield* devices.setPreferences(julie, { flows: {}, gone: ["seedCleanup", "plannedDeletion"] })
      expect(yield* devices.goneWanted).toEqual(["plannedDeletion", "seedCleanup"])
      expect((yield* devices.goneRecipients("plannedDeletion")).map((recipient) => recipient.name)).toEqual(["Julie"])
      expect(yield* devices.goneRecipients("stuckRemoval")).toEqual([])
    }).pipe(Effect.provide(cloud(IntegrationsLive).pipe(Layer.provide(Layer.effect(Apns, makeApns(null)))))))
})

const paired = (name: string, notificationToken: string | undefined, gone?: ReadonlyArray<GoneKind>) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    const { code } = yield* devices.createPairingCode
    const pairedDevice = yield* devices.pair({ code, name, apnsEnvironment: "development" })
    if (pairedDevice._tag === "None") return yield* Effect.die("pairing failed")
    const id: DeviceId = pairedDevice.value.deviceId
    if (notificationToken !== undefined) yield* devices.update(id, { notificationToken })
    if (gone !== undefined) yield* devices.setPreferences(id, { flows: {}, gone })
    return id
  })

const withApple = <A, E, R>(
  test: (apple: Effect.Success<typeof fakeApns>) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const apple = yield* fakeApns
    const apns = yield* makeApns({
      keyPem: Redacted.make(keyPem),
      keyId: "KEY123",
      teamId: "TEAM456",
      topic: "com.mathieuletyrant.quai"
    }, { development: apple.url, production: apple.url })
    return yield* test(apple).pipe(
      Effect.provide(cloud(IntegrationsLive).pipe(Layer.provide(Layer.succeed(Apns, apns))))
    )
  })

const journalLines = (kind: string) =>
  Effect.map(
    Effect.flatMap(Effect.service(Journal), (journal) => journal.since(undefined)),
    (tail) => tail.entries.filter((entry) => entry.kind === kind).map((entry) => entry.text)
  )

/** The notifications of what is gone, not the alerts. */
const pushed = (apple: Effect.Success<typeof fakeApns>) =>
  apple.hits.filter((hit) => String(hit.body.aps["thread-id"]).startsWith("gone.")).map((
    hit
  ) => [hit.body.aps.alert.title, hit.body.aps.alert.body, hit.body.aps["thread-id"]])

/** Vampire Diaries in Sonarr, with no torrent left: its season's space surely came back when deleted. */
const vampireHome = (torrents: Recording = { json: [] }): Readonly<Record<string, Recording>> => ({
  "sonarr GET /api/v3/series": {
    json: [{ id: 300, title: "The Vampire Diaries", year: 2009, tvdbId: 95491, tmdbId: 18165 }]
  },
  "sonarr GET /api/v3/history/since": { json: [] },
  "sonarr GET /api/v3/config/mediamanagement": "radarr/mediamanagement.json",
  "qbittorrent GET /api/v2/torrents/info": torrents,
  "reclaimerr GET /api/v1/candidates": "real/reclaimerr/candidates.json"
})

/** Reclaimerr's event of the deletion of the real home's Vampire Diaries S06 (candidate 7). */
const vampireDeleted = {
  items: [{
    id: "a1",
    type: "candidate.deleted",
    occurred_at: "2026-11-25T10:00:07Z",
    candidate_id: null,
    actor: { type: "system", id: null },
    payload: {
      action: "deleted",
      media_type: "series",
      title: "The Vampire Diaries",
      tmdb_id: 18165,
      candidate_id: 7,
      season_number: 6
    }
  }]
}

describe("gone: a planned deletion Reclaimerr carried out", () => {
  const deletedWatch = fileEventsWatchId("candidate.deleted")

  it.effect("its feed is watched while Quai Home reaches it, for the disk marks, on a Quai Home that allows it", () =>
    withApple(() =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({ services: ["reclaimerr"] })
        yield* home.connect
        // No iPhone wants Gone: its deletions are still disk marks.
        expect(home.watch(deletedWatch)).toEqual({
          id: deletedWatch,
          service: "reclaimerr",
          path: fileEventsRead("candidate.deleted", now).path,
          everySeconds: 60
        })
        expect(home.watch(fileEventsWatchId("candidate.moved"))?.service).toBe("reclaimerr")
        expect(home.watch(fileEventsWatchId("candidate.unmonitored"))?.service).toBe("reclaimerr")
        // An unmonitor that keeps the files gives nothing back: not watched.
        expect(home.watch("reclaimerr:candidate.unmonitored_only")).toBeUndefined()
      })
    ))

  it.effect("notified to the iPhones that turned it on, logged once, even let go; an hour late, logged only", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({ services: ["reclaimerr"] })
        // The last deletion Quai logged, before Quai Home went away for a while.
        home.journal.push({
          id: "0001764057600000-c000000",
          at: Date.parse("2026-11-25T08:00:00Z"),
          level: "info",
          source: "reclaimerr",
          kind: "reclaimerr.deleted",
          text: "Reclaimerr deleted Earlier"
        })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* paired("Julie", "note-julie", ["stuckRemoval"])
        // Up was let go in Quai: it is gone all the same.
        yield* (yield* HomeDocuments).put("fixes/dismissed/deletion-42", { at: 1 })
        yield* (yield* Hub).sync

        const stale = {
          ...up,
          id: "old",
          occurred_at: "2026-11-25T08:59:00Z",
          payload: { ...up.payload, candidate_id: 41, title: "Old" }
        }
        yield* home.snapshot(deletedWatch, { items: [stale, ...deletedPage().items] })
        expect(pushed(apple)).toEqual([
          ["Severance S01 is gone", "Deleted by Reclaimerr", "gone.plannedDeletion"],
          ["Up is gone", "Deleted by Reclaimerr", "gone.plannedDeletion"]
        ])
        expect(apple.hits.map((hit) => hit.path.split("/").at(-1))).toEqual(["note-mathieu", "note-mathieu"])
        expect(yield* journalLines("reclaimerr.deleted")).toEqual([
          "Reclaimerr deleted Old",
          "Reclaimerr deleted Severance S01",
          "Reclaimerr deleted Up"
        ])

        // Read again: nothing new.
        yield* home.snapshot(deletedWatch, { ...deletedPage(), has_more: true })
        expect(apple.hits).toHaveLength(2)
      })
    ))

  it.effect("each movie version Reclaimerr deletes is one event: notified once for its candidate, read once or later", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({ services: ["reclaimerr"] })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* (yield* Hub).sync
        yield* home.snapshot(deletedWatch, { items: [up, { ...up, id: "second-version" }] })
        expect(pushed(apple)).toEqual([["Up is gone", "Deleted by Reclaimerr", "gone.plannedDeletion"]])
        // A third version, in a later read: still the same candidate, gone already.
        yield* home.snapshot(deletedWatch, {
          items: [up, { ...up, id: "second-version" }, {
            ...up,
            id: "third-version",
            occurred_at: "2026-11-25T10:01:00Z"
          }]
        })
        expect(pushed(apple)).toHaveLength(1)
      })
    ))

  it.effect("what Reclaimerr deleted is a disk mark, on the disks of its kind, whether an iPhone wants Gone or not", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({ services: ["reclaimerr"] })
        yield* home.connect
        yield* home.snapshot(deletedWatch, deletedPage())
        expect(pushed(apple)).toEqual([])
        const marks = (yield* (yield* DiskReadings).marks).map((mark) => [mark.kind, mark.title, mark.holds])
        expect(marks).toEqual([["gone", "Up", "movies"], ["gone", "Severance S01", "shows"]])
      })
    ))

  it.effect("a season a rule unmonitored with its files deleted is gone: notified, logged and marked", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({ services: ["reclaimerr"] })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* (yield* Hub).sync
        const unmonitoredWatch = fileEventsWatchId("candidate.unmonitored")
        expect(home.watch(unmonitoredWatch)?.path).toBe(
          "/api/v1/events?event_type=candidate.unmonitored&limit=200&occurred_after=2026-11-25T09%3A00%3A00.000Z"
        )
        // What Reclaimerr 0.6.18 sent for the real home's Vampire Diaries: each season its own candidate.
        const season = (id: string, candidateId: number, seasonNumber: number) => ({
          ...vampireDeleted.items[0]!,
          id,
          type: "candidate.unmonitored",
          payload: {
            ...vampireDeleted.items[0]!.payload,
            action: "unmonitored",
            candidate_id: candidateId,
            season_number: seasonNumber
          }
        })
        yield* home.snapshot(unmonitoredWatch, { items: [season("u6", 7, 6), season("u7", 8, 7)] })
        expect(pushed(apple)).toEqual([
          ["The Vampire Diaries S06 is gone", "Deleted by Reclaimerr", "gone.plannedDeletion"],
          ["The Vampire Diaries S07 is gone", "Deleted by Reclaimerr", "gone.plannedDeletion"]
        ])
        expect(yield* journalLines("reclaimerr.deleted")).toEqual([
          "Reclaimerr deleted The Vampire Diaries S06",
          "Reclaimerr deleted The Vampire Diaries S07"
        ])
        const marks = (yield* (yield* DiskReadings).marks).map((mark) => [mark.kind, mark.title, mark.holds])
        expect(marks).toContainEqual(["gone", "The Vampire Diaries S06", "shows"])
        expect(marks).toContainEqual(["gone", "The Vampire Diaries S07", "shows"])
      })
    ))

  it.effect("a Cloud that starts again goes on from its last line in the journal", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({ services: ["reclaimerr"] })
        home.journal.push({
          id: "0001764064809000-c000000",
          at: Date.parse("2026-11-25T10:00:10Z"),
          level: "info",
          source: "reclaimerr",
          kind: "reclaimerr.deleted",
          text: "Reclaimerr deleted Severance S01"
        })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* (yield* Hub).sync
        yield* home.snapshot(deletedWatch, deletedPage())
        expect(pushed(apple).map(([title]) => title)).toEqual(["Up is gone"])
      })
    ))

  it.effect("the space back, when no torrent holds the files anymore; nothing when one may", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({
          services: ["sonarr", "qbittorrent", "reclaimerr"],
          answer: recordedHome(vampireHome())
        })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* (yield* Hub).sync
        // Its size is known from the candidates read before the deletion: the feed doesn't say it.
        expect(home.watch(deletionsWatchId)?.service).toBe("reclaimerr")
        yield* home.snapshot(deletionsWatchId, fixture("real/reclaimerr/candidates.json"))
        yield* home.snapshot(deletedWatch, vampireDeleted)
        expect(pushed(apple)).toEqual([
          ["Vampire Diaries S06 is gone", "Deleted by Reclaimerr · 24 GB back", "gone.plannedDeletion"]
        ])
        expect(yield* journalLines("reclaimerr.deleted")).toEqual([
          "Reclaimerr deleted Vampire Diaries S06 · 24 GB back"
        ])
      })
    ))

  it.effect("a torrent that may still seed the files: no space back", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const seeding = {
          json: [{
            hash: "abc",
            name: "The.Vampire.Diaries.S06.1080p.WEB-DL",
            progress: 1,
            ratio: 1,
            seeding_time: 3600,
            state: "stalledUP",
            size: 24_400_000_000,
            added_on: now / 1000 - 86400
          }]
        }
        const home = yield* makeFakeHome({
          services: ["sonarr", "qbittorrent", "reclaimerr"],
          answer: recordedHome(vampireHome(seeding))
        })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* (yield* Hub).sync
        yield* home.snapshot(deletionsWatchId, fixture("real/reclaimerr/candidates.json"))
        yield* home.snapshot(deletedWatch, vampireDeleted)
        expect(pushed(apple)).toEqual([[
          "Vampire Diaries S06 is gone",
          "Deleted by Reclaimerr",
          "gone.plannedDeletion"
        ]])
      })
    ))

  it.effect("a candidate never read: its name from the event, no space back", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(now)
        const home = yield* makeFakeHome({
          services: ["sonarr", "qbittorrent", "reclaimerr"],
          answer: recordedHome(vampireHome())
        })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["plannedDeletion"])
        yield* (yield* Hub).sync
        yield* home.snapshot(deletedWatch, vampireDeleted)
        expect(pushed(apple)).toEqual([
          ["The Vampire Diaries S06 is gone", "Deleted by Reclaimerr", "gone.plannedDeletion"]
        ])
      })
    ))
})

describe("gone: what Cleanuparr removed or cleaned", () => {
  it.effect("a stuck removal and a seed cleanup, each to the iPhones that turned its kind on", () =>
    withApple((apple) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(Date.parse("2026-11-19T12:00:00Z"))
        const home = yield* makeFakeHome({ services: ["cleanuparr"] })
        yield* home.connect
        yield* paired("Mathieu", "note-mathieu", ["stuckRemoval", "seedCleanup"])
        yield* paired("Julie", "note-julie", ["plannedDeletion"])
        expect(home.watch(cleanedWatchId)?.path).toBe(cleanedRead.path)

        yield* home.snapshot(removalsWatchId, fixture("cleanuparr/events-removed.json"))
        expect(pushed(apple)).toEqual([
          [
            "Old.Movie.1999.720p.BluRay.x264-GROUP is gone",
            "Cleanuparr took it out of the queue: stalled",
            "gone.stuckRemoval"
          ],
          [
            "Some.Show.S03E04.1080p.WEB.h264-ETHEL is gone",
            "Cleanuparr took it out of the queue: its import kept failing",
            "gone.stuckRemoval"
          ]
        ])

        yield* home.snapshot(cleanedWatchId, fixture("cleanuparr/events-cleaned.json"))
        expect(pushed(apple).slice(2)).toEqual([[
          "Fool.Night.S01.1080p.WEB-DL-GRP is gone",
          "Cleanuparr took it out of qBittorrent after seeding",
          "gone.seedCleanup"
        ]])
        expect(apple.hits.every((hit) => hit.path.endsWith("note-mathieu"))).toBe(true)
        expect(yield* journalLines("cleanuparr.cleaned")).toEqual([
          "Cleanuparr took Fool.Night.S01.1080p.WEB-DL-GRP out of qBittorrent after seeding (ratio 2.1, 14 days)"
        ])
      })
    ))
})
