import type { DeviceId } from "@quai/api"
import { DateTime } from "effect"
import QRCode from "qrcode"
import { useCallback, useEffect, useState } from "react"
import { call } from "../client.ts"

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
      setError(String(e))
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
    <section className="panel" aria-labelledby="pair">
      <h2 id="pair">Pair an iPhone</h2>
      {pairing === null || left === 0
        ? (
          <div className="row">
            <p className="grow muted" style={{ margin: 0 }}>
              One code per iPhone. It works once, for 10 minutes.
            </p>
            <button type="button" className="button" onClick={start}>Show a QR code</button>
          </div>
        )
        : (
          <div className="pair">
            <div className="qr" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0 }}>Open Quai on the iPhone and scan this code.</p>
              <p className="muted" style={{ margin: 0 }}>Or type it in the app:</p>
              <p className="code" style={{ margin: 0 }}>{pairing.code}</p>
              <p className="muted" style={{ margin: 0 }}>Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
            </div>
          </div>
        )}
      {error && <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{error}</p>}
    </section>
  )
}

export function IphonesPage() {
  const [devices, setDevices] = useState<ReadonlyArray<DeviceRow>>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    call((c) => c.console.devices()).then(setDevices, (e: unknown) => setError(String(e)))
  }, [])

  useEffect(() => refresh(), [refresh])

  const remove = async (id: DeviceId) => {
    await call((c) => c.console.removeDevice({ params: { id } }))
    refresh()
  }

  return (
    <>
      <div>
        <h1>iPhones</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>{devices.length} paired</p>
      </div>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      <PairIphone onPaired={refresh} />
      <section className="panel" aria-labelledby="devices">
        <h2 id="devices">Paired iPhones</h2>
        <div>
          {devices.length === 0 && <p className="muted" style={{ margin: 0 }}>None yet.</p>}
          {devices.map((d) => (
            <div className="row" key={d.id}>
              <div className="grow">
                <p style={{ margin: 0, fontWeight: 600 }}>{d.name}</p>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
                  {d.canStartActivities ? "Live Activities allowed" : "Live Activities not allowed yet"} · {ago(d.lastSeenAt)}
                </p>
              </div>
              <span className="pill">{d.apnsEnvironment === "development" ? "Xcode build" : "TestFlight"}</span>
              <button type="button" className="button danger" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
