import { describe, expect, it } from "@effect/vitest"
import { defaultAlertSettings, type DeviceId } from "@quai/api"
import { Effect, Layer, Redacted, Schema } from "effect"
import { generateKeyPairSync } from "node:crypto"
import { Alerts, alertState, reconcile } from "../src/alerts/Alerts.ts"
import { Devices } from "../src/home/Devices.ts"
import { arrHealthState, HealthChecks } from "../src/integrations/arrHealth.ts"
import { diskDetail, diskState } from "../src/integrations/disk.ts"
import { IntegrationsLive } from "../src/integrations/All.ts"
import { Apns } from "../src/push/Apns.ts"
import { cloud, makeFakeHome } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { fakeApns } from "./push/fakeApns.ts"

const keyPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString()

const radarrDown = alertState("serviceDown", "radarr", [{ what: "down", title: "Radarr isn't answering", detail: "No answer for 5 minutes", over: "Radarr answers again" }])
const tera = 1e12
const diskAt = (percent: number) => [{ path: "/", freeSpace: 1e9, totalSpace: 2e9 }, { path: "/downloads", freeSpace: percent * 2e10, totalSpace: 2 * tera }]

describe("alerts", () => {
  it("a reading starts what's new, ends what's gone, keeps the rest with its first time", () => {
    const first = reconcile([], radarrDown, 1000)
    expect(first.started.map((a) => a.id)).toEqual(["serviceDown:radarr:down"])
    const again = reconcile(first.next, radarrDown, 2000)
    expect([again.started, again.over, again.changed]).toEqual([[], [], false])
    expect(again.next[0]?.since).toBe(1000)
    const sonarrUp = reconcile(first.next, alertState("serviceDown", "sonarr", []), 3000)
    expect([sonarrUp.over, sonarrUp.changed]).toEqual([[], false])
    const back = reconcile(first.next, alertState("serviceDown", "radarr", []), 4000)
    expect(back.over.map((a) => a.over)).toEqual(["Radarr answers again"])
    expect(back.next).toEqual([])
  })

  it("the disk: low under the threshold, over 2 points above it, nothing in between", () => {
    const at = (percent: number) => ({ freeBytes: percent * 1e10, totalBytes: 1e12 })
    expect(diskState(at(9), 10)?.raised.map((r) => r.detail)).toEqual(["90 GB free (9%)"])
    expect(diskState(at(11), 10)).toBeNull()
    expect(diskState(at(12), 10)?.raised).toEqual([])
    expect(diskDetail({ freeBytes: 1.25e12, totalBytes: 2e12 })).toBe("1.3 TB free (62%)")
  })

  it.effect("an *arr's own problems, from the alert's level up, told apart by their check", () =>
    Effect.gen(function*() {
      const checks = yield* Schema.decodeUnknownEffect(HealthChecks)(fixture("radarr/health.json"))
      expect(arrHealthState("radarr", checks, "error").raised.map((r) => [r.what, r.title])).toEqual([["DownloadClientCheck", "Radarr reports a problem"]])
      expect(arrHealthState("radarr", checks, "warning").raised.map((r) => r.what)).toEqual(["IndexerStatusCheck", "DownloadClientCheck"])
    }))

  it.effect("watched, notified once to the iPhones that allowed it and didn't mute it, ended once, kept at home", () =>
    Effect.gen(function*() {
      const apple = yield* fakeApns
      const apns = yield* Apns.make({ keyPem: Redacted.make(keyPem), keyId: "KEY123", teamId: "TEAM456", topic: "com.mathieuletyrant.quai" }, { development: apple.url, production: apple.url })
      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome({ services: ["radarr", "sonarr", "prowlarr"] })
        yield* home.connect
        const devices = yield* Devices
        const pair = (name: string, notificationToken: string | null) =>
          Effect.gen(function*() {
            const { code } = yield* devices.createPairingCode
            const paired = yield* devices.pair({ code, name, apnsEnvironment: "development" })
            if (paired._tag === "None") return yield* Effect.die("pairing failed")
            if (notificationToken !== null) yield* devices.update(paired.value.deviceId, { notificationToken })
            return paired.value.deviceId as DeviceId
          })
        yield* pair("Mathieu", "note-mathieu")
        const julie = yield* pair("Julie", "note-julie")
        yield* pair("iPad", null)

        const watched = home.state.watches.map((w) => `${w.id} ${w.service} ${w.path}`)
        expect(watched).toContain("disk:space radarr /api/v3/diskspace")
        expect(watched).toContain("arr-health:prowlarr prowlarr /api/v1/health")
        expect(watched).toContain("health:prowlarr prowlarr /api/v1/system/status")

        yield* home.snapshot("disk:space", diskAt(4))
        expect(apple.hits.map((h) => h.path).sort()).toEqual(["/3/device/note-julie", "/3/device/note-mathieu"])
        const hit = apple.hits[0]!
        expect(hit.headers["apns-push-type"]).toBe("alert")
        expect(hit.headers["apns-topic"]).toBe("com.mathieuletyrant.quai")
        expect(hit.body.aps).toMatchObject({ alert: { title: "The media disk is running low", body: "80 GB free (4%)" }, "thread-id": "diskLow" })

        const alerts = yield* Alerts
        expect((yield* alerts.active).items.map((a) => [a.title, a.detail])).toEqual([["The media disk is running low", "80 GB free (4%)"]])
        expect(home.documents.has("alerts/active")).toBe(true)

        // Still low: the text follows, nobody is notified again.
        yield* home.snapshot("disk:space", diskAt(3))
        expect(apple.hits).toHaveLength(2)
        expect((yield* alerts.active).items[0]?.detail).toBe("60 GB free (3%)")
        yield* home.snapshot("disk:space", diskAt(11))
        expect(apple.hits).toHaveLength(2)
        yield* home.snapshot("disk:space", diskAt(12))
        expect(apple.hits.slice(2).map((h) => h.body.aps.alert.title)).toEqual(["The media disk has room again", "The media disk has room again"])
        expect((yield* alerts.active).items).toEqual([])

        // Julie mutes the *arr problems.
        yield* devices.setPreferences(julie, { flows: {}, mutedAlerts: ["arrHealth"] })
        yield* home.snapshot("arr-health:radarr", fixture("radarr/health.json"))
        expect(apple.hits.slice(4).map((h) => [h.path, h.body.aps.alert.title, h.body.aps.alert.body])).toEqual([
          ["/3/device/note-mathieu", "Radarr reports a problem", "Unable to communicate with Transmission. Connection refused (transmission:9091)"]
        ])

        // Turned off: its alerts end without a notification, and its watches go.
        yield* alerts.saveSettings({ ...defaultAlertSettings, arrHealth: { enabled: false, level: "error" } })
        expect((yield* alerts.active)).toEqual({ items: [], enabled: ["serviceDown", "diskLow"] })
        expect(apple.hits).toHaveLength(5)
      }).pipe(Effect.provide(cloud(IntegrationsLive).pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }))
})
