import { useEffect, useState } from "react"
import { call } from "../client.ts"
import { Badge, Button, errorText, Field, inputClass, PageBar, Section } from "../ui.tsx"

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
    call((c) => c.push.pushSettings()).then(setStatus, (e: unknown) => setMessage({ ok: false, text: errorText(e) }))
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
      setMessage({ ok: false, text: errorText(e) })
    }
  }

  const remove = async () => {
    setStatus(await call((c) => c.push.removePushKey()))
    setMessage(null)
  }

  return (
    <Section
      title="Apple push key"
      description="The .p8 key from developer.apple.com → Keys, with Apple Push Notifications service enabled. It is stored encrypted on this server and never shown again."
    >
      {status && (
        <div>
          <Badge tone={status.configured ? "ok" : "warn"}>
            {status.configured
              ? `Key ${status.keyId} · ${status.source === "console" ? "saved here" : "from the environment"}`
              : "Not set: nothing is pushed"}
          </Badge>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Key file (.p8)" hint={fileName || undefined}>
          <input type="file" accept=".p8" className="text-sm text-muted file:mr-3 file:h-10 file:rounded-full file:border-0 file:bg-raised file:px-4 file:font-semibold file:text-text" onChange={(e) => pick(e.target.files?.[0])} />
        </Field>
        <Field label="Key ID">
          <input className={inputClass} value={keyId} onChange={(e) => setKeyId(e.target.value.toUpperCase())} placeholder="72YS3G4HXU" maxLength={10} />
        </Field>
        <Field label="Team ID">
          <input className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value.toUpperCase())} placeholder="FFGWB5G2PN" maxLength={10} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button disabled={keyPem === null || keyId.length !== 10 || teamId.length !== 10} onClick={save}>Save the key</Button>
        {status?.source === "console" && <Button variant="danger" onClick={remove}>Remove</Button>}
      </div>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-ok" : "text-danger"}>{message.text}</p>}
    </Section>
  )
}

export function SettingsPage() {
  return (
    <>
      <PageBar title="Settings" />
      <PushKeyPanel />
    </>
  )
}
