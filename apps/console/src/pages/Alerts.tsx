import { type AlertSettings, diskBackAbovePoints } from "@quai/api"
import { type ReactNode, useCallback, useState } from "react"
import { call } from "../client.ts"
import { useLoad } from "../load.ts"
import {
  Async,
  cx,
  ErrorCallout,
  errorText,
  CloudOfflineState,
  Icon,
  type IconName,
  Input,
  type Notice,
  PageBar,
  PageBody,
  Panel,
  Row,
  Rows,
  Segmented,
  Skeleton,
  Toast,
  Toggle
} from "../ui"

const levelOptions = [{ value: "error", label: "Errors" }, { value: "warning", label: "Warnings too" }] as const

/** A whole number between `min` and `max`, or null for what isn't one. */
const wholeBetween = (text: string, min: number, max: number) => {
  const value = Number(text)
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

/** "over at 12 %": where the alert ends, so it doesn't flap. */
const diskEnd = (belowPercent: number) => `over at ${belowPercent + diskBackAbovePoints} %`

/** One alert: its icon, what it watches, on or off, and its setting as a sentence. */
function AlertRow({ icon, title, description, enabled, onToggle, children }: {
  icon: IconName
  title: string
  description: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children: ReactNode
}) {
  return (
    <li className="flex gap-4 px-5 py-5">
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-item transition-colors", enabled ? "bg-accent-soft text-accent-soft-text" : "bg-raised text-faint")}>
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className={cx("text-body font-semibold", !enabled && "text-muted")}>{title}</p>
            <p className="mt-0.5 text-small leading-relaxed text-muted">{description}</p>
          </div>
          <Toggle checked={enabled} onChange={onToggle} label={title} />
        </div>
        {enabled && <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-2 text-small text-text-2">{children}</div>}
      </div>
    </li>
  )
}

/** A short number inside a sentence, saved when it holds a valid value and loses focus. */
function InlineNumber({ label, value, min, max, onSave }: {
  label: string
  value: number
  min: number
  max: number
  onSave: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const parsed = wholeBetween(text, min, max)
  const save = () => {
    if (parsed === null) setText(String(value))
    else if (parsed !== value) onSave(parsed)
  }
  return (
    <span className="inline-block w-16">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        aria-label={label}
        className="h-8 px-2 text-center tabular-nums"
        value={text}
        invalid={parsed === null}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
      />
    </span>
  )
}

/** The alerts, each saved as soon as it changes. */
function AlertList({ settings, onSave }: { settings: AlertSettings; onSave: (next: AlertSettings) => void }) {
  const { serviceDown, diskLow, arrHealth, plannedDeletion } = settings
  return (
    <Panel flush>
      <ul className="divide-y divide-line">
        <AlertRow
          icon="server"
          title="Service down"
          description="A service Quai Home reaches stops answering. Checked every minute."
          enabled={serviceDown.enabled}
          onToggle={(enabled) => onSave({ ...settings, serviceDown: { ...serviceDown, enabled } })}
        >
          <span>Notify after</span>
          <InlineNumber
            key={serviceDown.afterMinutes}
            label="Minutes without an answer"
            value={serviceDown.afterMinutes}
            min={1}
            max={240}
            onSave={(afterMinutes) => onSave({ ...settings, serviceDown: { ...serviceDown, afterMinutes } })}
          />
          <span>min without an answer</span>
        </AlertRow>
        <AlertRow
          icon="disk"
          title="Low disk space"
          description="The media disk, as Radarr or Sonarr sees it. Checked every 10 minutes."
          enabled={diskLow.enabled}
          onToggle={(enabled) => onSave({ ...settings, diskLow: { ...diskLow, enabled } })}
        >
          <span>Notify under</span>
          <InlineNumber
            key={diskLow.belowPercent}
            label="Percent of the disk free"
            value={diskLow.belowPercent}
            min={1}
            max={50}
            onSave={(belowPercent) => onSave({ ...settings, diskLow: { ...diskLow, belowPercent } })}
          />
          <span>% free</span>
          <span className="text-faint">· {diskEnd(diskLow.belowPercent)}</span>
        </AlertRow>
        <AlertRow
          icon="alert"
          title="Problems Radarr, Sonarr and Prowlarr report"
          description="What their System → Status page lists: an indexer failing, a download client unreachable. Checked every 5 minutes."
          enabled={arrHealth.enabled}
          onToggle={(enabled) => onSave({ ...settings, arrHealth: { ...arrHealth, enabled } })}
        >
          <span>Notify on</span>
          <Segmented
            label="Which problems"
            value={arrHealth.level}
            options={levelOptions}
            onChange={(level) => onSave({ ...settings, arrHealth: { ...arrHealth, level } })}
          />
        </AlertRow>
        <AlertRow
          icon="trash"
          title="Planned deletion"
          description="A title Reclaimerr is going to delete or move on its own, with its reason. Checked every 30 minutes."
          enabled={plannedDeletion.enabled}
          onToggle={(enabled) => onSave({ ...settings, plannedDeletion: { enabled } })}
        >
          <span>Notify when it's planned, and again on its last day</span>
        </AlertRow>
      </ul>
    </Panel>
  )
}

/** How alerts reach the iPhones, next to the list. */
function HowPanel() {
  return (
    <Panel title="How alerts work">
      <Rows>
        <Row label="Sent">When it starts, when it's over</Row>
        <Row label="To">Every iPhone that allows notifications</Row>
        <Row label="Muted">Per iPhone, in the app's Settings</Row>
      </Rows>
    </Panel>
  )
}

function LoadingList() {
  return (
    <Panel flush>
      <ul className="divide-y divide-line">
        {[0, 1, 2].map((n) => (
          <li key={n} className="flex gap-4 px-5 py-5">
            <Skeleton className="size-9" />
            <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" /></div>
          </li>
        ))}
      </ul>
    </Panel>
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
      <PageBar title="Alerts" subtitle="Notifications for what goes wrong and may last." />
      <PageBody>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Async
            state={settings}
            loading={<LoadingList />}
            offline={<CloudOfflineState what="Alert settings" />}
            failed={(error) => <ErrorCallout error={error} />}
          >
            {(data) => <AlertList settings={data} onSave={save} />}
          </Async>
          <HowPanel />
        </div>
      </PageBody>
      <Toast notice={notice} onDone={clearNotice} />
    </>
  )
}
