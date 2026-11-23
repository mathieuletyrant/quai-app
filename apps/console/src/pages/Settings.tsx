import type { CloudLink, ConnectionSettings, Health, PushSettings } from "@quai/api"
import type { ReactNode } from "react"
import { call, type LinkStatus, useLink } from "../client.ts"
import { useLoad } from "../load.ts"
import { Async, Callout, Code, ErrorCallout, Eyebrow, Mono, PageBar, PageBody, Panel, Row, Rows, Skeleton, Status } from "../ui"
import { CloudChanged, loadOverview, SetupChecklist } from "./setup.tsx"

/** "Less than a minute", "42 min", "5 h 12 min", "3 days" */
const uptime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  if (m < 1) return "Less than a minute"
  if (m < 60) return `${m} min`
  if (m < 2880) return `${Math.floor(m / 60)} h ${m % 60} min`
  return `${Math.floor(m / 1440)} days`
}

/** Rows while their values load. */
function LoadingRows({ labels }: { labels: ReadonlyArray<string> }) {
  return <Rows>{labels.map((l) => <Row key={l} label={l}><Skeleton className="ml-auto h-4 w-28" /></Row>)}</Rows>
}

const failed = (error: unknown) => <ErrorCallout error={error} />

const linkStatus: Record<LinkStatus, ReactNode> = {
  online: <Status tone="ok">Connected</Status>,
  offline: <Status tone="danger">Not connected</Status>,
  checking: <Skeleton className="ml-auto h-4 w-24" />
}

const notSet = <span className="text-muted">—</span>

/** What to do about the link, when there's something to do. */
function LinkAdvice({ cloud, status }: { cloud: CloudLink; status: LinkStatus }) {
  if (!cloud.configured) {
    return <Callout tone="warn" icon="unlink" title="No Quai Cloud yet">Set <Code>QUAI_CLOUD_URL</Code> on Quai Home to the Cloud's <Code>/home</Code> address (<Code>wss://…/home</Code>) and restart it. The services can be set meanwhile.</Callout>
  }
  if (status !== "offline") return null
  return <Callout icon="info">Check that Quai Cloud is running at this address, and that Quai Home's <Code>QUAI_CLOUD_URL</Code> points at its <Code>/home</Code>.</Callout>
}

/** The Cloud's version and uptime, once it answered. */
function CloudHealth({ health }: { health: Health | null }) {
  return (
    <>
      <Row label="Version">{health === null ? notSet : <Mono>{health.version}</Mono>}</Row>
      <Row label="Running for">{health === null ? notSet : <span className="tabular-nums">{uptime(health.uptimeSeconds)}</span>}</Row>
    </>
  )
}

/** The Quai Cloud this home links to, and how the link is doing. */
function CloudPanel() {
  const { status, epoch } = useLink()
  const overview = useLoad(loadOverview, [epoch])
  const health = useLoad<Health>(() => call((c) => c.system.health()), [epoch])
  return (
    <Panel title="Quai Cloud" description={<>Runs the flows and pushes to Apple. Quai Home links to it with <Code>QUAI_CLOUD_URL</Code>.</>}>
      <Async state={overview} loading={<LoadingRows labels={["Address", "Link", "Version", "Running for"]} />} failed={failed}>
        {(o) => (
          <div className="flex flex-col gap-4">
            <Rows>
              <Row label="Address">{o.cloud.url === undefined ? notSet : <Mono>{o.cloud.url}</Mono>}</Row>
              <Row label="Link">{o.cloud.configured ? linkStatus[status] : <Status tone="warn">Not set</Status>}</Row>
              <CloudHealth health={health.data} />
            </Rows>
            <LinkAdvice cloud={o.cloud} status={status} />
            <CloudChanged cloud={o.cloud} onDone={overview.refresh} />
          </div>
        )}
      </Async>
    </Panel>
  )
}

/** Each header's name with its value masked, or None. */
function AccessHeaders({ names }: { names: ReadonlyArray<string> }) {
  if (names.length === 0) return <span className="text-muted">None</span>
  return <span className="flex flex-col items-end gap-1">{names.map((name) => <Mono key={name}>{name}: ••••••</Mono>)}</span>
}

function PushRows({ push }: { push: PushSettings }) {
  return (
    <Rows>
      <Row label="Push key">{push.configured ? <Status tone="ok">Configured</Status> : <Status tone="warn">Not configured</Status>}</Row>
      <Row label="Key ID"><Mono>{push.keyId ?? "—"}</Mono></Row>
      <Row label="Team ID"><Mono>{push.teamId ?? "—"}</Mono></Row>
      <Row label="App"><Mono>{push.topic}</Mono></Row>
    </Rows>
  )
}

function AccessRows({ access }: { access: ConnectionSettings }) {
  return (
    <Rows>
      <Row label="Public address">{access.publicUrl === undefined ? notSet : <Mono>{access.publicUrl}</Mono>}</Row>
      <Row label="Access headers"><AccessHeaders names={access.accessHeaderNames} /></Row>
    </Rows>
  )
}

const loadCloudSettings = () =>
  Promise.all([call((c) => c.push.pushSettings()), call((c) => c.connection.connectionSettings())]).then(([push, access]) => ({ push, access }))

const cloudSettingsOffline = <p className="text-body text-muted">Shown once Quai Home is connected to Quai Cloud.</p>

/** Quai Cloud's own settings: shown here, set with its environment variables. */
function CloudSettingsPanel() {
  const { epoch } = useLink()
  const settings = useLoad(loadCloudSettings, [epoch])
  return (
    <Panel title="Set on Quai Cloud" description="Its own environment variables: shown here, changed there.">
      <Async state={settings} loading={<LoadingRows labels={["Push key", "Key ID", "Team ID", "App"]} />} offline={cloudSettingsOffline} failed={failed}>
        {({ push, access }) => (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-3">
              <Eyebrow>Apple push</Eyebrow>
              <PushRows push={push} />
              <p className="text-caption text-faint"><Code>QUAI_APNS_KEY_FILE</Code> <Code>QUAI_APNS_KEY_ID</Code> <Code>QUAI_APNS_TEAM_ID</Code></p>
              {!push.configured && <Callout tone="warn" icon="alert" title="Nothing is pushed">Without a key, iPhones get no Live Activity.</Callout>}
            </section>
            <section className="flex flex-col gap-3 border-t border-line pt-5">
              <Eyebrow>From outside</Eyebrow>
              <AccessRows access={access} />
              <p className="text-caption text-faint"><Code>QUAI_PUBLIC_URL</Code> <Code>QUAI_PUBLIC_HEADERS</Code>: both go into the pairing QR code.</p>
            </section>
          </div>
        )}
      </Async>
    </Panel>
  )
}

export function SettingsPage() {
  return (
    <>
      <PageBar title="Settings" subtitle="The Quai Cloud this home links to, and what's set on it." />
      <PageBody>
        <SetupChecklist />
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <CloudPanel />
          <CloudSettingsPanel />
        </div>
      </PageBody>
    </>
  )
}
