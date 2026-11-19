import { useEffect, useState } from "react"
import { call } from "../client.ts"
import { Badge, errorText, PageBar, Section } from "../ui.tsx"

interface PushStatus {
  readonly configured: boolean
  readonly keyId?: string
  readonly teamId?: string
  readonly topic: string
}

/** The Apple push key is Quai Cloud's own configuration: shown here, set on the Cloud. */
function PushKeyPanel() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    call((c) => c.push.pushSettings()).then(setStatus, (e: unknown) => setError(errorText(e)))
  }, [])

  return (
    <Section
      title="Apple push key"
      description="Live Activities are pushed with Quai Cloud's own key (QUAI_APNS_KEY_FILE, QUAI_APNS_KEY_ID and QUAI_APNS_TEAM_ID on the Cloud). It isn't set from here."
    >
      {status && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={status.configured ? "ok" : "warn"}>
            {status.configured ? `Configured · key ${status.keyId}` : "Not configured: nothing is pushed"}
          </Badge>
          <span className="text-sm text-muted">App: {status.topic}</span>
        </div>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
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
