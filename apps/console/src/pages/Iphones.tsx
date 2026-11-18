import type { DeviceId } from "@quai/api"
import { DateTime } from "effect"
import QRCode from "qrcode"
import { useCallback, useEffect, useState } from "react"
import { call } from "../client.ts"
import { Badge, Button, Card, errorText, PageHeader } from "../ui.tsx"

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
  if (date === undefined) return "never seen"
  const minutes = Math.round((Date.now() - DateTime.toEpochMillis(date)) / 60_000)
  return minutes < 1 ? "seen just now" : minutes < 60 ? `seen ${minutes} min ago` : `seen ${Math.round(minutes / 60)} h ago`
}

function PairIphone({ onPaired }: { onPaired: () => void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setError(null)
    try {
      const result = await call((c) => c.console.createPairingCode({ payload: { serverUrls: [window.location.origin] } }))
      const qrSvg = await QRCode.toString(result.link, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      setPairing({ code: result.code, expiresAt: DateTime.toEpochMillis(result.expiresAt), qrSvg })
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

  return (
    <Card title="Pair an iPhone" description={pairing === null || left === 0 ? "One code per iPhone. It works once, for 10 minutes." : undefined}
      actions={(pairing === null || left === 0) && <Button onClick={start}>Show a QR code</Button>}>
      {pairing !== null && left > 0 && (
        <div className="flex flex-wrap items-center gap-6">
          <div className="size-[216px] rounded-2xl bg-white p-3" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
          <div className="flex flex-col gap-2.5">
            <p>Open Quai on the iPhone and scan this code.</p>
            <p className="text-muted">Or type it in the app:</p>
            <p className="font-mono text-[22px] tracking-[3px]">{pairing.code}</p>
            <p className="text-muted">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </Card>
  )
}

export function IphonesPage() {
  const [devices, setDevices] = useState<ReadonlyArray<DeviceRow>>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    call((c) => c.console.devices()).then(setDevices, (e: unknown) => setError(errorText(e)))
  }, [])

  useEffect(() => refresh(), [refresh])

  const remove = async (id: DeviceId) => {
    await call((c) => c.console.removeDevice({ params: { id } }))
    refresh()
  }

  return (
    <>
      <PageHeader title="iPhones" subtitle={`${devices.length} paired`} />
      {error && <p role="alert" className="text-danger">{error}</p>}
      <PairIphone onPaired={refresh} />
      <Card title="Paired iPhones">
        {devices.length === 0 && <p className="text-muted">None yet.</p>}
        <ul className="divide-y divide-line">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{d.name}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {d.canStartActivities ? "Live Activities allowed" : "Live Activities not allowed yet"} · {ago(d.lastSeenAt)}
                </p>
              </div>
              <Badge>{d.apnsEnvironment === "development" ? "Xcode build" : "TestFlight"}</Badge>
              <Button variant="danger" size="sm" aria-label={`Remove ${d.name}`} onClick={() => remove(d.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
