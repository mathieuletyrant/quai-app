import type { Health } from "@quai/api"
import { type ReactNode, useEffect, useState } from "react"
import { call, useHome } from "../client.ts"
import { Callout, Code, errorText, Mono, PageBar, PageBody, Panel, Row, Rows, Skeleton, Status } from "../ui"

interface PushStatus {
  readonly configured: boolean
  readonly keyId?: string
  readonly teamId?: string
  readonly topic: string
}

const uptime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  return m < 1 ? "Less than a minute" : m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days`
}

/** Rows while their values load. */
const loadingRows = (labels: ReadonlyArray<string>) => (
  <Rows>{labels.map((l) => <Row key={l} label={l}><Skeleton className="ml-auto h-4 w-28" /></Row>)}</Rows>
)

function useLoad<A>(load: () => Promise<A>): { value: A | null; error: unknown } {
  const [state, setState] = useState<{ value: A | null; error: unknown }>({ value: null, error: null })
  useEffect(() => {
    load().then((value) => setState({ value, error: null }), (error: unknown) => setState({ value: null, error }))
  }, [])
  return state
}

const failed = (error: unknown): ReactNode => error !== null && <Callout tone="danger" icon="alert">{errorText(error)}</Callout>

/** The Apple push key is Quai Cloud's own configuration: shown here, set on the Cloud. */
function PushKeyPanel() {
  const { value: status, error } = useLoad(() => call((c) => c.push.pushSettings()))
  return (
    <Panel
      title="Apple push"
      description={<>Live Activities are pushed with Quai Cloud's own key, set on the Cloud with <Code>QUAI_APNS_KEY_FILE</Code>, <Code>QUAI_APNS_KEY_ID</Code> and <Code>QUAI_APNS_TEAM_ID</Code>. It isn't set from here.</>}
    >
      {failed(error)}
      {status === null
        ? error === null && loadingRows(["Push key", "Key ID", "Team ID", "App"])
        : (
          <Rows>
            <Row label="Push key">{status.configured ? <Status tone="ok">Configured</Status> : <Status tone="warn">Not configured</Status>}</Row>
            <Row label="Key ID"><Mono>{status.keyId ?? "—"}</Mono></Row>
            <Row label="Team ID"><Mono>{status.teamId ?? "—"}</Mono></Row>
            <Row label="App"><Mono>{status.topic}</Mono></Row>
          </Rows>
        )}
      {status && !status.configured && (
        <div className="mt-4"><Callout tone="warn" icon="alert" title="Nothing is pushed">Without a key, iPhones get no Live Activity. Set the three variables on Quai Cloud and restart it.</Callout></div>
      )}
    </Panel>
  )
}

function CloudPanel() {
  const { value: health, error } = useLoad<Health>(() => call((c) => c.system.health()))
  return (
    <Panel title="Quai Cloud" description="Runs the flows and pushes to Apple. It keeps nothing about the home.">
      {failed(error)}
      {health === null
        ? error === null && loadingRows(["Version", "Running for", "Address"])
        : (
          <Rows>
            <Row label="Version"><Mono>{health.version}</Mono></Row>
            <Row label="Running for"><span className="tabular-nums">{uptime(health.uptimeSeconds)}</span></Row>
            <Row label="Address"><Mono>{window.location.host}</Mono></Row>
          </Rows>
        )}
    </Panel>
  )
}

/** The address from outside and the proxy's access headers: Quai Cloud's own configuration, names only. */
function PublicAccessPanel() {
  const { value: settings, error } = useLoad(() => call((c) => c.connection.connectionSettings()))
  return (
    <Panel
      title="Access from outside"
      description={<>Where the app reaches Quai Cloud away from home, set with <Code>QUAI_PUBLIC_URL</Code>, and the headers the reverse proxy in front of it requires, set with <Code>QUAI_PUBLIC_HEADERS</Code>. Both go into the pairing QR code.</>}
    >
      {failed(error)}
      {settings === null
        ? error === null && loadingRows(["Public address", "Access headers"])
        : (
          <Rows>
            <Row label="Public address">{settings.publicUrl === undefined ? <span className="text-muted">Not set</span> : <Mono>{settings.publicUrl}</Mono>}</Row>
            <Row label="Access headers">
              {settings.accessHeaderNames.length === 0
                ? <span className="text-muted">None</span>
                : <span className="flex flex-col items-end gap-1">{settings.accessHeaderNames.map((name) => <Mono key={name}>{name}: ••••••</Mono>)}</span>}
            </Row>
          </Rows>
        )}
    </Panel>
  )
}

function HomePanel() {
  const { status } = useHome()
  return (
    <Panel title="Quai Home" description="Runs next to the services with their keys, and keeps the paired iPhones and the flows.">
      <Rows>
        <Row label="Link to Quai Cloud">
          {status === "online" ? <Status tone="ok">Connected</Status> : status === "offline" ? <Status tone="danger">Offline</Status> : <Skeleton className="ml-auto h-4 w-24" />}
        </Row>
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
