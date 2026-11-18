import type { DeviceId } from "@quai/api"
import { DateTime } from "effect"
import QRCode from "qrcode"
import { useCallback, useEffect, useState } from "react"
import { call } from "../client.ts"
import { Badge, Button, errorText, PageBar } from "../ui.tsx"

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
  readonly qrSvg: string
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
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setError(null)
    try {
      const result = await call((c) => c.console.createPairingCode({ payload: { serverUrls: [window.location.origin] } }))
      const qrSvg = await QRCode.toString(result.link, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      setPairing({ code: result.code, expiresAt: DateTime.toEpochMillis(result.expiresAt), qrSvg })
      setNow(Date.now())
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    if (pairing === null) return
    const timer = setInterval(() => {
      setNow(Date.now())
      onPaired()
    }, 3000)
    return () => clearInterval(timer)
  }, [pairing, onPaired])

  const left = pairing === null ? 0 : Math.max(0, Math.round((pairing.expiresAt - now) / 1000))
  return { pairing: left > 0 ? pairing : null, left, error, start, stop: () => setPairing(null) }
}

const th = "px-4 py-3 text-left text-[13px] font-semibold text-muted md:px-6"
const td = "px-4 py-3.5 md:px-6"

export function IphonesPage() {
  const [devices, setDevices] = useState<ReadonlyArray<DeviceRow>>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    call((c) => c.console.devices()).then(setDevices, (e: unknown) => setError(errorText(e)))
  }, [])

  useEffect(() => refresh(), [refresh])
  const { pairing, left, error: pairingError, start, stop } = usePairing(refresh)

  const remove = async (device: DeviceRow) => {
    if (!window.confirm(`Remove ${device.name}? It stops receiving Live Activities until paired again.`)) return
    await call((c) => c.console.removeDevice({ params: { id: device.id } }))
    refresh()
  }

  return (
    <>
      <PageBar title="iPhones">
        {pairing ? <Button variant="secondary" onClick={stop}>Done</Button> : <Button onClick={start}>Pair an iPhone</Button>}
      </PageBar>

      {pairing && (
        <section className="flex flex-wrap items-center gap-6 border-b border-line bg-panel px-4 py-6 md:px-6">
          <div className="size-[180px] rounded-2xl bg-white p-3" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
          <div className="flex flex-col gap-2">
            <p className="font-semibold">Open Quai on the iPhone and scan this code.</p>
            <p className="text-sm text-muted">Or type it in the app:</p>
            <p className="font-mono text-[22px] tracking-[3px]">{pairing.code}</p>
            <p className="text-sm text-muted">One code per iPhone. Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}.</p>
          </div>
        </section>
      )}
      {(error ?? pairingError) && <p role="alert" className="px-6 py-3 text-danger">{error ?? pairingError}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel/60">
            <tr>
              <th className={th}>iPhone</th>
              <th className={th}>App</th>
              <th className={th}>Live Activities</th>
              <th className={th}>Last seen</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {devices.map((d) => (
              <tr key={d.id} className="transition hover:bg-white/3">
                <td className={`${td} font-semibold`}>{d.name}</td>
                <td className={td}><Badge>{d.apnsEnvironment === "development" ? "Xcode build" : "TestFlight"}</Badge></td>
                <td className={td}>
                  {d.canStartActivities ? <Badge tone="ok">Allowed</Badge> : <Badge tone="warn">Not allowed yet</Badge>}
                </td>
                <td className={`${td} text-muted`}>{ago(d.lastSeenAt)}</td>
                <td className={`${td} text-right`}>
                  <Button variant="ghost" size="sm" className="hover:text-danger" aria-label={`Remove ${d.name}`} onClick={() => remove(d)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {devices.length === 0 && <p className="py-12 text-center text-muted">No iPhone paired yet.</p>}
      </div>
    </>
  )
}
