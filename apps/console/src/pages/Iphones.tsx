import type { DeviceId, HomeOverview } from "@quai/api"
import { DateTime } from "effect"
import QRCode from "qrcode"
import { type ReactNode, useEffect, useState } from "react"
import { call, isCloudOffline, useLink } from "../client.ts"
import { duration } from "../format.ts"
import { useLoad } from "../load.ts"
import { CloudChanged, loadOverview } from "./setup.tsx"
import { withConsoleAddresses } from "./pairing.ts"
import {
  Async,
  Badge,
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorCallout,
  CloudOfflineState,
  Icon,
  IconButton,
  Mono,
  PageBar,
  PageBody,
  Panel,
  Status
} from "../ui"

interface Device {
  readonly id: DeviceId
  readonly name: string
  readonly apnsEnvironment: "development" | "production"
  readonly canStartActivities: boolean
  readonly lastSeenAt?: DateTime.Utc | undefined
}

interface Pairing {
  readonly code: string
  readonly expiresAt: number
  readonly lifetime: number
  readonly qrSvg: string
  readonly link: string
  readonly accessHeaderNames: ReadonlyArray<string>
}

/** The QR code's colours: the qrcode library takes hex, not the theme's variables. */
const qrColors = { dark: "#0b0b0f", light: "#ffffff" }

/** "Just now", "12 min ago", "Never" */
const lastSeen = (date: DateTime.Utc | undefined) => {
  if (date === undefined) return "Never"
  const minutes = Math.round((Date.now() - DateTime.toEpochMillis(date)) / 60_000)
  return minutes < 1 ? "Just now" : `${duration(minutes)} ago`
}

/** The Cloud's address from Quai Home, for the QR code: Quai Cloud adds its public one. */
const cloudUrlsOf = (overview: HomeOverview | null) => overview?.cloud.url === undefined ? [] : [overview.cloud.url]

/** "4:05": seconds as minutes and seconds. */
const countdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

const subtitle = (devices: ReadonlyArray<Device> | null, offline: boolean) => {
  if (devices === null || offline) return "The iPhones Quai starts Live Activities on"
  if (devices.length === 0) return "None paired yet"
  return `${devices.length} paired · ${devices.filter((device) => device.canStartActivities).length} allow Live Activities`
}

/**
 * Creates a pairing code and shows it as a QR code until it's used or expires. `cloudUrls`: where
 * the app reaches Quai Cloud, as Quai Home links to it (the console itself is Quai Home's).
 * `consolePublicUrl`: Quai Home's console from outside, added to the code for "Open the console".
 */
function usePairing(onPaired: () => void, cloudUrls: ReadonlyArray<string>, consolePublicUrl: string | undefined) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<unknown>(null)
  const [starting, setStarting] = useState(false)

  const start = async () => {
    setError(null)
    setStarting(true)
    try {
      const result = await call((api) => api.console.createPairingCode({ payload: { serverUrls: cloudUrls } }))
      const link = withConsoleAddresses(result.link, window.location.origin, consolePublicUrl)
      const qrSvg = await QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: qrColors })
      const expiresAt = DateTime.toEpochMillis(result.expiresAt)
      setPairing({ code: result.code, expiresAt, lifetime: expiresAt - Date.now(), qrSvg, link, accessHeaderNames: result.accessHeaderNames })
      setNow(Date.now())
    } catch (failure) {
      setError(failure)
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    if (pairing === null) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(onPaired, 3000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [pairing, onPaired])

  const left = pairing === null ? 0 : Math.max(0, Math.round((pairing.expiresAt - now) / 1000))
  return { pairing: left > 0 ? pairing : null, left, error, starting, start, stop: () => setPairing(null) }
}

const steps = [
  { title: "Open Quai on the iPhone", text: "From TestFlight or an Xcode build." },
  { title: "Scan this code", text: "With the Camera app. On the iPhone itself, tap Open in Quai. One code pairs one iPhone." },
  { title: "Allow Live Activities", text: "The iPhone shows up below, ready to receive them." }
]

/** The steps to pair beside the QR code, while a code is live. */
function PairingPanel({ pairing, left, onNew, onDone }: { pairing: Pairing; left: number; onNew: () => void; onDone: () => void }) {
  return (
    <Panel>
      <div className="flex flex-col gap-8 pt-2 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div>
            <h2 className="text-heading font-semibold tracking-heading">Pair an iPhone</h2>
            <p className="mt-1 text-body text-muted">The code carries this Quai Cloud's address and a one-time invitation.</p>
            {pairing.accessHeaderNames.length > 0 && (
              <p className="mt-1 text-body text-muted">It also carries the access headers for your proxy: <HeaderNames names={pairing.accessHeaderNames} />.</p>
            )}
          </div>
          <PairingSteps />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onDone}>Done</Button>
            <Button variant="ghost" icon="refresh" onClick={onNew}>New code</Button>
          </div>
        </div>
        <PairingCode pairing={pairing} left={left} />
      </div>
    </Panel>
  )
}

/** "X-Auth, X-Token", in monospace. */
function HeaderNames({ names }: { names: ReadonlyArray<string> }) {
  return names.map((name, index) => <span key={name}>{index > 0 && ", "}<Mono>{name}</Mono></span>)
}

function PairingSteps() {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-caption font-bold text-text-2 ring-1 ring-line-strong">{index + 1}</span>
          <div className="pt-0.5">
            <p className="text-copy font-semibold">{step.title}</p>
            <p className="mt-0.5 text-body text-muted">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The QR code, the code in letters, and the time it has left. */
function PairingCode({ pairing, left }: { pairing: Pairing; left: number }) {
  const share = Math.min(1, (left * 1000) / Math.max(pairing.lifetime, 1))
  return (
    <div className="flex shrink-0 flex-col items-center gap-4 rounded-card border border-line bg-bg/60 p-6 md:w-75">
      <div className="size-50 rounded-card bg-white p-3.5" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
      <p className="font-mono text-display font-semibold tracking-code text-text" aria-label={`Pairing code ${pairing.code}`}>{pairing.code}</p>
      <Button className="w-full md:hidden" onClick={() => { window.location.href = pairing.link }}>Open in Quai on this iPhone</Button>
      <div className="flex w-full flex-col gap-2">
        <div className="h-1 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${share * 100}%` }} />
        </div>
        <p className="flex items-center justify-center gap-1.5 text-caption text-muted tabular-nums">
          <Icon name="clock" size={13} />
          Expires in {countdown(left)}
        </p>
      </div>
    </div>
  )
}

/** An iPhone's name and the start of its id. */
function DeviceName({ device }: { device: Device }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-logo bg-raised text-muted ring-1 ring-line"><Icon name="phone" size={16} /></span>
      <span className="min-w-0">
        <span className="block truncate text-item font-semibold">{device.name}</span>
        <Mono className="block truncate text-mini text-faint">{device.id.slice(0, 8)}</Mono>
      </span>
    </span>
  )
}

const columns: ReadonlyArray<Column<Device>> = [
  { header: "iPhone", primary: true, cell: (device) => <DeviceName device={device} /> },
  { header: "App", cell: (device) => <Badge>{device.apnsEnvironment === "development" ? "Xcode build" : "TestFlight"}</Badge> },
  { header: "Live Activities", cell: (device) => device.canStartActivities ? <Status tone="ok">Allowed</Status> : <Status tone="warn">Not allowed yet</Status> },
  { header: "Last seen", cell: (device) => <span className="text-muted tabular-nums">{lastSeen(device.lastSeenAt)}</span> }
]

/** The paired iPhones, or skeleton rows while `devices` is null. */
function DeviceTable({ devices, onRemove, emptyAction }: { devices: ReadonlyArray<Device> | null; onRemove: (device: Device) => void; emptyAction: ReactNode }) {
  return (
    <DataTable
      columns={columns}
      rows={devices}
      rowKey={(device) => device.id}
      actions={(device) => <IconButton icon="trash" label={`Remove ${device.name}`} className="hover:bg-danger-soft hover:text-danger-text" onClick={() => onRemove(device)} />}
      empty={
        <EmptyState icon="phone" title="No iPhone paired yet" action={emptyAction}>
          Pair one to follow downloads, playback and server health on its Lock Screen and in the Dynamic Island.
        </EmptyState>
      }
    />
  )
}

export function IphonesPage() {
  const { epoch } = useLink()
  const devices = useLoad(() => call((api) => api.console.devices()), [epoch])
  const overview = useLoad(loadOverview, [epoch])
  const { pairing, left, error: pairingError, starting, start, stop } = usePairing(devices.refresh, cloudUrlsOf(overview.data), overview.data?.consolePublicUrl)

  const remove = async (device: Device) => {
    if (!window.confirm(`Remove ${device.name}? It stops receiving Live Activities until paired again.`)) return
    try {
      await call((api) => api.console.removeDevice({ params: { id: device.id } }))
    } catch (failure) {
      devices.setError(failure)
    }
    devices.refresh()
  }

  const errors = [devices.error, pairingError]
  const offline = errors.some(isCloudOffline)
  const count = devices.data?.length ?? 0
  const pairButton = <Button icon="qr" disabled={starting || offline} onClick={start}>{starting ? "Creating a code…" : "Pair an iPhone"}</Button>
  const table = (rows: ReadonlyArray<Device> | null) => <DeviceTable devices={rows} onRemove={remove} emptyAction={!pairing && pairButton} />

  return (
    <>
      <PageBar title="iPhones" subtitle={subtitle(devices.data, offline)}>
        {!pairing && count > 0 && pairButton}
      </PageBar>

      <PageBody>
        <ErrorCallout unlessOffline error={errors.find((error) => error !== null && !isCloudOffline(error)) ?? null} title="Something went wrong" />
        {overview.data && <CloudChanged cloud={overview.data.cloud} onDone={overview.refresh} />}
        {pairing && <PairingPanel pairing={pairing} left={left} onNew={start} onDone={stop} />}

        <Panel flush title="Paired iPhones" description="Each one receives every enabled flow, unless it turns a flow off in the app.">
          <div className="border-t border-line">
            <Async
              state={{ data: devices.data, error: errors.find(isCloudOffline) ?? devices.error }}
              loading={table(null)}
              offline={<CloudOfflineState what="Paired iPhones" />}
            >
              {table}
            </Async>
          </div>
        </Panel>
      </PageBody>
    </>
  )
}
