import { useEffect, useState } from "react"
import { call } from "../client.ts"

interface PushStatus {
  readonly configured: boolean
  readonly source?: "console" | "environment"
  readonly keyId?: string
  readonly teamId?: string
  readonly topic: string
}

export function PushKeyPanel() {
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

