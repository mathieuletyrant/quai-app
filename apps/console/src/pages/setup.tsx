import type { CloudLink } from "@quai/api"
import { useState } from "react"
import { call, callHome, useLink } from "../client.ts"
import { useLoad } from "../load.ts"
import { Button, Callout, Checklist, ChecklistItem, Code, Mono } from "../ui"

/** Where Quai Home stands: its version and the Quai Cloud it links to. */
export const loadOverview = () => callHome((api) => api.home.overview())

/** Whether Quai Home reaches at least one service, and at least one iPhone is paired. */
const loadProgress = () =>
  Promise.all([
    callHome((api) => api.services.list()).then((list) => list.some((setup) => setup.source !== "none")),
    call((api) => api.console.devices()).then((devices) => devices.length > 0, () => false)
  ]).then(([services, iphones]) => ({ services, iphones }))

/** The two steps to a working Quai, until both are done. */
export function SetupChecklist() {
  const { epoch } = useLink()
  const progress = useLoad(loadProgress, [epoch])
  const done = progress.data
  if (done === null || (done.services && done.iphones)) return null
  return (
    <Checklist title="Set up Quai">
      <ChecklistItem index={1} done={done.services} title="Set up the services" href="#services">
        Where Quai Home reaches Radarr, Sonarr and the others, with their keys.
      </ChecklistItem>
      <ChecklistItem index={2} done={done.iphones} title="Pair an iPhone" href="#iphones">
        Scan a QR code with the Quai app: Live Activities and alerts start.
      </ChecklistItem>
    </Checklist>
  )
}

/**
 * `QUAI_CLOUD_URL` names another Quai Cloud than the one the iPhones were paired with: they still
 * talk to the old one. Said until the iPhones are paired again.
 */
export function CloudChanged({ cloud, onDone }: { cloud: CloudLink; onDone: () => void }) {
  const [saving, setSaving] = useState(false)
  if (cloud.previousUrl === undefined) return null
  const done = () => {
    setSaving(true)
    void callHome((api) => api.home.acknowledgeCloud()).finally(() => {
      setSaving(false)
      onDone()
    })
  }
  return (
    <Callout
      tone="warn"
      icon="refresh"
      title="Quai Cloud changed: pair the iPhones again"
      action={<Button variant="secondary" size="sm" disabled={saving} onClick={done}>They're paired again</Button>}
    >
      The iPhones were paired with <Mono>{cloud.previousUrl}</Mono>, and still talk to it. Remove them and pair them again with this Cloud. Flows, alerts and the journal are kept.{" "}
      <span className="text-faint">(<Code>QUAI_CLOUD_URL</Code> changed.)</span>
    </Callout>
  )
}
