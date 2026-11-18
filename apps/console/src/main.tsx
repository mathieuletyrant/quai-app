import type { DeviceId, Health } from "@quai/api"
import { DateTime } from "effect"
import QRCode from "qrcode"
import { StrictMode, useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { call } from "./client.ts"
import "./styles.css"

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

interface PushStatus {
  readonly configured: boolean
  readonly source?: "console" | "environment"
  readonly keyId?: string
  readonly teamId?: string
  readonly topic: string
}

function PushKeyPanel() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [keyPem, setKeyPem] = useState<string | null>(null)
  const [fileName, setFileName] = useState("")
  const [keyId, setKeyId] = useState("")
  const [teamId, setTeamId] = useState("")
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    call((c) => c.push.pushSettings()).then(setStatus, (e: unknown) => setMessage({ ok: false, text: String(e) }))
  }, [])

  const pick = async (file: File | undefined) => {
    if (file === undefined) return
    setFileName(file.name)
    setKeyPem(await file.text())
    // Apple names the file AuthKey_<key id>.p8: fill the key id from it.
    const id = file.name.match(/AuthKey_([A-Z0-9]{10})\.p8$/)?.[1]
    if (id !== undefined) setKeyId(id)
  }

  const save = async () => {
    if (keyPem === null) return
    try {
      setStatus(await call((c) => c.push.savePushKey({ payload: { keyPem, keyId, teamId } })))
      setKeyPem(null)
      setFileName("")
      setMessage({ ok: true, text: "Saved. Live Activities will be pushed from now on." })
    } catch (e) {
      const text = typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e)
      setMessage({ ok: false, text })
    }
  }

  const remove = async () => {
    setStatus(await call((c) => c.push.removePushKey()))
    setMessage(null)
  }

  return (
    <section className="panel" aria-labelledby="push">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 id="push" className="grow">Apple push key</h2>
        {status && (
          <span className="pill">
            {status.configured
              ? `Key ${status.keyId} · ${status.source === "console" ? "saved here" : "from the environment"}`
              : "Not set: nothing is pushed"}
          </span>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        The .p8 key from developer.apple.com → Keys, with Apple Push Notifications service enabled. It is stored
        encrypted on this server and never shown again.
      </p>
      <div className="form">
        <label className="field">
          <span>Key file (.p8)</span>
          <input type="file" accept=".p8" onChange={(e) => pick(e.target.files?.[0])} />
          {fileName && <span className="muted">{fileName}</span>}
        </label>
        <label className="field">
          <span>Key ID</span>
          <input value={keyId} onChange={(e) => setKeyId(e.target.value.toUpperCase())} placeholder="72YS3G4HXU" maxLength={10} />
        </label>
        <label className="field">
          <span>Team ID</span>
          <input value={teamId} onChange={(e) => setTeamId(e.target.value.toUpperCase())} placeholder="FFGWB5G2PN" maxLength={10} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="button" disabled={keyPem === null || keyId.length !== 10 || teamId.length !== 10} onClick={save}>
          Save the key
        </button>
        {status?.source === "console" && (
          <button type="button" className="button danger" onClick={remove}>Remove</button>
        )}
      </div>
      {message && <p role={message.ok ? "status" : "alert"} style={{ margin: 0, color: message.ok ? "var(--ok)" : "var(--danger)" }}>{message.text}</p>}
    </section>
  )
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [devices, setDevices] = useState<ReadonlyArray<DeviceRow>>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    call((c) => c.console.devices()).then(setDevices, (e: unknown) => setError(String(e)))
  }, [])

  useEffect(() => {
    call((c) => c.system.health()).then(setHealth, (e: unknown) => setError(String(e)))
    refresh()
  }, [refresh])

  const remove = async (id: DeviceId) => {
    await call((c) => c.console.removeDevice({ params: { id } }))
    refresh()
  }

  return (
    <div className="layout">
      <nav className="nav" aria-label="Console">
        <div className="brand"><img src="/icon.svg" alt="" />Quai</div>
      </nav>
      <main>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div className="grow">
            <h1>iPhones</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {health ? `Quai ${health.version}` : "Connecting…"} · {devices.length} paired
            </p>
          </div>
          {health && <span className="status"><span className="dot" />Server up</span>}
        </div>
        {error && <p role="alert" style={{ color: "var(--danger)" }}>Server unreachable: {error}</p>}
        <PairIphone onPaired={refresh} />
        <PushKeyPanel />
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
      </main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
