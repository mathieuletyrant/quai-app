import type { AlertSettings } from "@quai/api"
import { type ReactNode, useCallback, useState } from "react"
import { call } from "../client.ts"
import { useLoad } from "../load.ts"
import {
  Async,
  ErrorCallout,
  errorText,
  Field,
  FieldGroup,
  HomeOfflineState,
  Icon,
  type IconName,
  Input,
  type Notice,
  PageBar,
  PageBody,
  Panel,
  Segmented,
  Skeleton,
  Toast,
  Toggle
} from "../ui"

const levelOptions = [{ value: "error", label: "Errors" }, { value: "warning", label: "Warnings and errors" }] as const

/** A whole number between `min` and `max`, or null for what isn't one. */
const wholeBetween = (text: string, min: number, max: number) => {
  const value = Number(text)
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

/** One alert: its icon, what it watches, on or off, and its setting. */
function AlertPanel({ icon, title, description, enabled, onToggle, children }: {
  icon: IconName
  title: string
  description: ReactNode
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children: ReactNode
}) {
  return (
    <Panel
      title={<span className="flex items-center gap-2.5"><Icon name={icon} size={17} />{title}</span>}
      description={description}
      actions={<Toggle checked={enabled} onChange={onToggle} label={`${title} alert`} />}
    >
      <div className={enabled ? "" : "opacity-50"}>{children}</div>
    </Panel>
  )
}

/** A number field that saves when it holds a valid value and loses focus. */
function NumberSetting({ label, hint, value, min, max, disabled, onSave }: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  disabled: boolean
  onSave: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const parsed = wholeBetween(text, min, max)
  const save = () => {
    if (parsed === null) setText(String(value))
    else if (parsed !== value) onSave(parsed)
  }
  return (
    <Field label={label} hint={hint} className="max-w-40">
      <Input
        type="number"
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        invalid={parsed === null}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
    </Field>
  )
}

/** The three alerts, each saved as soon as it changes. */
function AlertsForm({ settings, onSave }: { settings: AlertSettings; onSave: (next: AlertSettings) => void }) {
  const { serviceDown, diskLow, arrHealth } = settings
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <AlertPanel
        icon="server"
        title="Service down"
        description="A service Quai Home reaches stops answering. One notification when it stops, one when it's back."
        enabled={serviceDown.enabled}
        onToggle={(enabled) => onSave({ ...settings, serviceDown: { ...serviceDown, enabled } })}
      >
        <NumberSetting
          key={serviceDown.afterMinutes}
          label="After"
          hint="Minutes without an answer, 1 to 240."
          value={serviceDown.afterMinutes}
          min={1}
          max={240}
          disabled={!serviceDown.enabled}
          onSave={(afterMinutes) => onSave({ ...settings, serviceDown: { ...serviceDown, afterMinutes } })}
        />
      </AlertPanel>
      <AlertPanel
        icon="disk"
        title="Low disk space"
        description="The media disk, as Radarr (or Sonarr) sees it, read every 10 minutes."
        enabled={diskLow.enabled}
        onToggle={(enabled) => onSave({ ...settings, diskLow: { ...diskLow, enabled } })}
      >
        <NumberSetting
          key={diskLow.belowPercent}
          label="Under"
          hint="Percent of the disk left free, 1 to 50. Over once 2 points above it."
          value={diskLow.belowPercent}
          min={1}
          max={50}
          disabled={!diskLow.enabled}
          onSave={(belowPercent) => onSave({ ...settings, diskLow: { ...diskLow, belowPercent } })}
        />
      </AlertPanel>
      <AlertPanel
        icon="alert"
        title="Problems Radarr, Sonarr and Prowlarr report"
        description="What their System → Status page lists: an indexer failing, a download client unreachable, a root folder missing. Read every 5 minutes."
        enabled={arrHealth.enabled}
        onToggle={(enabled) => onSave({ ...settings, arrHealth: { ...arrHealth, enabled } })}
      >
        <FieldGroup label="Report">
          <Segmented
            label="Report"
            value={arrHealth.level}
            options={levelOptions}
            onChange={(level) => onSave({ ...settings, arrHealth: { ...arrHealth, level } })}
          />
        </FieldGroup>
      </AlertPanel>
    </div>
  )
}

function LoadingPanels() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      {[0, 1, 2].map((n) => <Skeleton key={n} className="h-40 w-full" />)}
    </div>
  )
}

export function AlertsPage() {
  const settings = useLoad(() => call((c) => c.consoleAlerts.settings()), [])
  const [notice, setNotice] = useState<Notice | null>(null)
  const clearNotice = useCallback(() => setNotice(null), [])

  const save = async (next: AlertSettings) => {
    const previous = settings.data
    settings.setData(() => next)
    try {
      const saved = await call((c) => c.consoleAlerts.save({ payload: next }))
      settings.setData(() => saved)
      setNotice({ ok: true, text: "Saved" })
    } catch (error) {
      if (previous !== null) settings.setData(() => previous)
      setNotice({ ok: false, text: errorText(error) })
    }
  }

  return (
    <>
      <PageBar
        title="Alerts"
        subtitle="Something wrong that may last: one notification when it starts, one when it's over. Each iPhone can mute them in the app's Settings."
      />
      <PageBody>
        <Async
          state={settings}
          loading={<LoadingPanels />}
          offline={<HomeOfflineState what="the alerts" />}
          failed={(error) => <ErrorCallout error={error} />}
        >
          {(data) => <AlertsForm settings={data} onSave={save} />}
        </Async>
      </PageBody>
      <Toast notice={notice} onDone={clearNotice} />
    </>
  )
}
