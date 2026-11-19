import type { DeviceId } from "@quai/api"
import { DateTime } from "effect"
import QRCode from "qrcode"
import { useCallback, useEffect, useState } from "react"
import { call, isHomeOffline, useHome } from "../client.ts"
import {
  Badge,
  Button,
  Callout,
  type Column,
  DataTable,
  EmptyState,
  errorText,
  HomeOfflineState,
  Icon,
  IconButton,
  Mono,
  PageBar,
  PageBody,
  Panel,
  Status
} from "../ui.tsx"

interface DeviceRow {
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

const ago = (date: DateTime.Utc | undefined) => {
  if (date === undefined) return "Never"
  const minutes = Math.round((Date.now() - DateTime.toEpochMillis(date)) / 60_000)
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`
}

/** Creates a pairing code and shows it as a QR code until it's used or expires. */
function usePairing(onPaired: () => void) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<unknown>(null)
  const [starting, setStarting] = useState(false)

  const start = async () => {
    setError(null)
    setStarting(true)
    try {
      const result = await call((c) => c.console.createPairingCode({ payload: { serverUrls: [window.location.origin] } }))
      const qrSvg = await QRCode.toString(result.link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b0b0f", light: "#ffffff" } })
      const expiresAt = DateTime.toEpochMillis(result.expiresAt)
      setPairing({ code: result.code, expiresAt, lifetime: expiresAt - Date.now(), qrSvg, link: result.link, accessHeaderNames: result.accessHeaderNames })
      setNow(Date.now())
    } catch (e) {
      setError(e)
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

function PairingPanel({ pairing, left, onNew, onDone }: { pairing: Pairing; left: number; onNew: () => void; onDone: () => void }) {
  const share = Math.min(1, (left * 1000) / Math.max(pairing.lifetime, 1))
  return (
    <Panel>
      <div className="flex flex-col gap-8 pt-2 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Pair an iPhone</h2>
            <p className="mt-1 text-[13px] text-muted">The code carries this Quai Cloud's address and a one-time invitation.</p>
            {pairing.accessHeaderNames.length > 0 && (
              <p className="mt-1 text-[13px] text-muted">
                It also carries the access headers for your proxy: {pairing.accessHeaderNames.map((name, i) => (
                  <span key={name}>{i > 0 && ", "}<Mono>{name}</Mono></span>
                ))}.
              </p>
            )}
          </div>
          <ol className="flex flex-col gap-4">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-bold text-text-2 ring-1 ring-line-strong">{i + 1}</span>
                <div className="pt-0.5">
                  <p className="text-[14px] font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onDone}>Done</Button>
            <Button variant="ghost" icon="refresh" onClick={onNew}>New code</Button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-4 rounded-card border border-line bg-bg/60 p-6 md:w-[300px]">
          <div className="size-[200px] rounded-[14px] bg-white p-3.5" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
          <p className="font-mono text-[22px] font-semibold tracking-[0.2em] text-text" aria-label={`Pairing code ${pairing.code}`}>{pairing.code}</p>
          <Button className="w-full md:hidden" onClick={() => { window.location.href = pairing.link }}>Open in Quai on this iPhone</Button>
          <div className="flex w-full flex-col gap-2">
            <div className="h-1 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${share * 100}%` }} />
            </div>
            <p className="flex items-center justify-center gap-1.5 text-[12px] text-muted tabular-nums">
              <Icon name="clock" size={13} />
              Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

const columns: ReadonlyArray<Column<DeviceRow>> = [
  {
    header: "iPhone",
    primary: true,
    cell: (d) => (
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-raised text-muted ring-1 ring-line"><Icon name="phone" size={16} /></span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold">{d.name}</span>
          <Mono className="block truncate text-[11.5px] text-faint">{d.id.slice(0, 8)}</Mono>
        </span>
      </span>
    )
  },
  { header: "App", cell: (d) => <Badge>{d.apnsEnvironment === "development" ? "Xcode build" : "TestFlight"}</Badge> },
  {
    header: "Live Activities",
    cell: (d) => d.canStartActivities ? <Status tone="ok">Allowed</Status> : <Status tone="warn">Not allowed yet</Status>
  },
  { header: "Last seen", cell: (d) => <span className="text-muted tabular-nums">{ago(d.lastSeenAt)}</span> }
]

export function IphonesPage() {
  const [devices, setDevices] = useState<ReadonlyArray<DeviceRow> | null>(null)
  const [error, setError] = useState<unknown>(null)
  const { epoch } = useHome()

  const refresh = useCallback(() => {
    call((c) => c.console.devices()).then((d) => {
      setDevices(d)
      setError(null)
    }, setError)
  }, [])

  useEffect(() => refresh(), [refresh, epoch])
  const { pairing, left, error: pairingError, starting, start, stop } = usePairing(refresh)

  const remove = async (device: DeviceRow) => {
    if (!window.confirm(`Remove ${device.name}? It stops receiving Live Activities until paired again.`)) return
    try {
      await call((c) => c.console.removeDevice({ params: { id: device.id } }))
    } catch (e) {
      setError(e)
    }
    refresh()
  }

  const offline = isHomeOffline(error) || isHomeOffline(pairingError)
  const failure = [error, pairingError].find((e) => e !== null && !isHomeOffline(e))
  const count = devices?.length ?? 0
  const pairButton = <Button icon="qr" disabled={starting || offline} onClick={start}>{starting ? "Creating a code…" : "Pair an iPhone"}</Button>

  return (
    <>
      <PageBar
        title="iPhones"
        subtitle={devices === null || offline
          ? "The iPhones Quai starts Live Activities on"
          : count === 0
          ? "None paired yet"
          : `${count} paired · ${devices.filter((d) => d.canStartActivities).length} allow Live Activities`}
      >
        {!pairing && count > 0 && pairButton}
      </PageBar>

      <PageBody>
        {failure !== undefined && <Callout tone="danger" icon="alert" title="Something went wrong">{errorText(failure)}</Callout>}
        {pairing && <PairingPanel pairing={pairing} left={left} onNew={start} onDone={stop} />}

        <Panel flush title="Paired iPhones" description="Each one receives every enabled flow, unless it turns a flow off in the app.">
          <div className="border-t border-line">
            {offline && devices === null
              ? <HomeOfflineState what="Paired iPhones" />
              : (
                <DataTable
                  columns={columns}
                  rows={devices}
                  rowKey={(d) => d.id}
                  actions={(d) => <IconButton icon="trash" label={`Remove ${d.name}`} className="hover:bg-danger-soft hover:text-danger-text" onClick={() => remove(d)} />}
                  empty={
                    <EmptyState icon="phone" title="No iPhone paired yet" action={!pairing && pairButton}>
                      Pair one to follow downloads, playback and server health on its Lock Screen and in the Dynamic Island.
                    </EmptyState>
                  }
                />
              )}
          </div>
        </Panel>
      </PageBody>
    </>
  )
}
