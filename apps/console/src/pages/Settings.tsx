import type { Health } from "@quai/api"
import type { ReactNode } from "react"
import { call, type HomeStatus, useHome } from "../client.ts"
import { useLoad } from "../load.ts"
import { Async, Callout, Code, ErrorCallout, Mono, PageBar, PageBody, Panel, Row, Rows, Skeleton, Status } from "../ui"

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

/** The Apple push key is Quai Cloud's own configuration: shown here, set on the Cloud. */
function PushKeyPanel() {
  const status = useLoad(() => call((c) => c.push.pushSettings()), [])
  return (
    <Panel
      title="Apple push"
      description={<>Live Activities are pushed with Quai Cloud's own key, set on the Cloud with <Code>QUAI_APNS_KEY_FILE</Code>, <Code>QUAI_APNS_KEY_ID</Code> and <Code>QUAI_APNS_TEAM_ID</Code>. It isn't set from here.</>}
    >
      <Async state={status} loading={<LoadingRows labels={["Push key", "Key ID", "Team ID", "App"]} />} failed={failed}>
        {(s) => (
          <>
            <Rows>
              <Row label="Push key">{s.configured ? <Status tone="ok">Configured</Status> : <Status tone="warn">Not configured</Status>}</Row>
              <Row label="Key ID"><Mono>{s.keyId ?? "—"}</Mono></Row>
              <Row label="Team ID"><Mono>{s.teamId ?? "—"}</Mono></Row>
              <Row label="App"><Mono>{s.topic}</Mono></Row>
            </Rows>
            {!s.configured && (
              <div className="mt-4"><Callout tone="warn" icon="alert" title="Nothing is pushed">Without a key, iPhones get no Live Activity. Set the three variables on Quai Cloud and restart it.</Callout></div>
            )}
          </>
        )}
      </Async>
    </Panel>
  )
}

function CloudPanel() {
  const health = useLoad<Health>(() => call((c) => c.system.health()), [])
  return (
    <Panel title="Quai Cloud" description="Runs the flows and pushes to Apple. It keeps nothing about the home.">
      <Async state={health} loading={<LoadingRows labels={["Version", "Running for", "Address"]} />} failed={failed}>
        {(h) => (
          <Rows>
            <Row label="Version"><Mono>{h.version}</Mono></Row>
            <Row label="Running for"><span className="tabular-nums">{uptime(h.uptimeSeconds)}</span></Row>
            <Row label="Address"><Mono>{window.location.host}</Mono></Row>
          </Rows>
        )}
      </Async>
    </Panel>
  )
}

/** The address from outside and the proxy's access headers: Quai Cloud's own configuration, names only. */
function PublicAccessPanel() {
  const settings = useLoad(() => call((c) => c.connection.connectionSettings()), [])
  return (
    <Panel
      title="Access from outside"
      description={<>Where the app reaches Quai Cloud away from home, set with <Code>QUAI_PUBLIC_URL</Code>, and the headers the reverse proxy in front of it requires, set with <Code>QUAI_PUBLIC_HEADERS</Code>. Both go into the pairing QR code.</>}
    >
      <Async state={settings} loading={<LoadingRows labels={["Public address", "Access headers"]} />} failed={failed}>
        {(s) => (
          <Rows>
            <Row label="Public address">{s.publicUrl === undefined ? <span className="text-muted">Not set</span> : <Mono>{s.publicUrl}</Mono>}</Row>
            <Row label="Access headers"><AccessHeaders names={s.accessHeaderNames} /></Row>
          </Rows>
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

const linkStatus: Record<HomeStatus, ReactNode> = {
  online: <Status tone="ok">Connected</Status>,
  offline: <Status tone="danger">Offline</Status>,
  checking: <Skeleton className="ml-auto h-4 w-24" />
}

function HomePanel() {
  const { status } = useHome()
  return (
    <Panel title="Quai Home" description="Runs next to the services with their keys, and keeps the paired iPhones and the flows.">
      <Rows>
        <Row label="Link to Quai Cloud">{linkStatus[status]}</Row>
        <Row label="Connects with"><Code>QUAI_CLOUD_URL</Code></Row>
      </Rows>
      {status === "offline" && (
        <div className="mt-4">
          <Callout icon="info">Check that Quai Home is running and that its <Code>QUAI_CLOUD_URL</Code> points at this Cloud's <Code>/home</Code> address.</Callout>
        </div>
      )}
    </Panel>
  )
}

export function SettingsPage() {
  return (
    <>
      <PageBar title="Settings" subtitle="How this Quai is set up. Everything here comes from environment variables." />
      <PageBody>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <PushKeyPanel />
            <PublicAccessPanel />
          </div>
          <div className="flex flex-col gap-6">
            <HomePanel />
            <CloudPanel />
          </div>
        </div>
      </PageBody>
    </>
  )
}
