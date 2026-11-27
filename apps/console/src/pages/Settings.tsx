import type { CloudLink, ConnectionSettings, PushSettings } from "@quai/api"
import type { ReactNode } from "react"
import { call, type LinkStatus, useLink } from "../client.ts"
import { useLoad } from "../load.ts"
import {
  Async,
  Callout,
  Code,
  ErrorCallout,
  Eyebrow,
  Mono,
  PageBar,
  PageBody,
  Panel,
  Row,
  Rows,
  Skeleton,
  Status
} from "../ui"
import { loadOverview } from "./setup.tsx"

function LoadingRows({ labels }: { labels: ReadonlyArray<string> }) {
  return (
    <Rows>
      {labels.map((label) => (
        <Row key={label} label={label}>
          <Skeleton className="ml-auto h-4 w-28" />
        </Row>
      ))}
    </Rows>
  )
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
    return (
      <Callout tone="warn" icon="unlink" title="No Quai Cloud yet">
        Set <Code>QUAI_CLOUD_URL</Code> on Quai Home to the Cloud's <Code>/home</Code>{" "}
        address (<Code>wss://…/home</Code>) and restart it. Everything here works without it; the app needs it to reach
        this home, and to get its Live Activities and alerts.
      </Callout>
    )
  }
  if (status !== "offline") return null
  return (
    <Callout icon="info">
      Check that Quai Cloud is running at this address, and that Quai Home's <Code>QUAI_CLOUD_URL</Code> points at its
      {" "}
      <Code>/home</Code>.
    </Callout>
  )
}

const pushOffline = "Without an Apple push key, your iPhones get no Live Activity and no alert."

/** The hosted Cloud says nothing about its key, unless pushes can't go out. */
export function HostedPushWarning() {
  const { epoch } = useLink()
  const push = useLoad<PushSettings>(() => call((api) => api.push.pushSettings()), [epoch])
  if (push.data === null || push.data.configured) return null
  return (
    <Callout tone="warn" icon="alert" title="Notifications are off on Quai's Cloud">
      {pushOffline} It's on our side: write to us.
    </Callout>
  )
}

/** The Cloud's version, as it said when it last welcomed this home. */
const cloudVersion = (cloud: CloudLink) => cloud.version === undefined ? notSet : <Mono>{cloud.version}</Mono>

/** A Cloud of one's own: where it is, the link, its version. */
function OwnCloud({ cloud, status }: { cloud: CloudLink; status: LinkStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <Rows>
        <Row label="Address">{cloud.url === undefined ? notSet : <Mono>{cloud.url}</Mono>}</Row>
        <Row label="Link">{cloud.configured ? linkStatus[status] : <Status tone="warn">Not set</Status>}</Row>
        <Row label="Version">{cloudVersion(cloud)}</Row>
      </Rows>
      <LinkAdvice cloud={cloud} status={status} />
    </div>
  )
}

const ownDescription = <>
  How the app reaches this home, and what sends its pushes. Quai Home links to it at <Code>QUAI_CLOUD_URL</Code>.
</>

/**
 * The Quai Cloud this home links to, when it is one's own or none is set yet. Quai's hosted Cloud
 * has no Settings page (`needsSettings`).
 */
function CloudPanel() {
  const { status, epoch } = useLink()
  const overview = useLoad(loadOverview, [epoch])
  return (
    <Async
      state={overview}
      loading={
        <Panel title="Quai Cloud">
          <LoadingRows labels={["Link", "Version"]} />
        </Panel>
      }
      failed={failed}
    >
      {(home) => (
        <>
          <Panel title="Quai Cloud" description={ownDescription}>
            <OwnCloud cloud={home.cloud} status={status} />
          </Panel>
          {home.cloud.configured && <OwnCloudSettingsPanel />}
        </>
      )}
    </Async>
  )
}

/** Each header's name with its value masked, or None. */
function AccessHeaders({ names }: { names: ReadonlyArray<string> }) {
  if (names.length === 0) return <span className="text-muted">None</span>
  return (
    <span className="flex flex-col items-end gap-1">{names.map((name) => <Mono key={name}>{name}: ••••••</Mono>)}</span>
  )
}

function PushRows({ push }: { push: PushSettings }) {
  return (
    <Rows>
      <Row label="Apple push key">
        {push.configured ? <Status tone="ok">Ready</Status> : <Status tone="warn">Missing</Status>}
      </Row>
      <Row label="Key ID">
        <Mono>{push.keyId ?? "—"}</Mono>
      </Row>
      <Row label="Team ID">
        <Mono>{push.teamId ?? "—"}</Mono>
      </Row>
      <Row label="App">
        <Mono>{push.topic}</Mono>
      </Row>
    </Rows>
  )
}

const sameAsHome = <span className="text-muted">Only at home</span>

function AwayRows({ access }: { access: ConnectionSettings }) {
  return (
    <Rows>
      <Row label="Address in the QR code">
        {access.publicUrl === undefined ? sameAsHome : <Mono>{access.publicUrl}</Mono>}
      </Row>
      <Row label="Headers for your proxy">
        <AccessHeaders names={access.accessHeaderNames} />
      </Row>
    </Rows>
  )
}

const loadCloudSettings = () =>
  Promise.all([call((api) => api.push.pushSettings()), call((api) => api.connection.connectionSettings())]).then((
    [push, access]
  ) => ({ push, access }))

const cloudSettingsOffline = <p className="text-body text-muted">
  Shown once Quai Home has started.
</p>

/** A Cloud of one's own: what's set on it, shown here, changed with its environment variables. */
function OwnCloudSettingsPanel() {
  const { epoch } = useLink()
  const settings = useLoad(loadCloudSettings, [epoch])
  return (
    <Panel
      title="Set on your Quai Cloud"
      description="Changed with its environment variables, on the machine that runs it."
    >
      <Async
        state={settings}
        loading={<LoadingRows labels={["Apple push key", "Key ID", "Team ID", "App"]} />}
        offline={cloudSettingsOffline}
        failed={failed}
      >
        {({ push, access }) => (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-3">
              <Eyebrow>Notifications</Eyebrow>
              <PushRows push={push} />
              <p className="text-caption text-faint">
                <Code>QUAI_APNS_KEY_FILE</Code> (or <Code>QUAI_APNS_KEY</Code>), <Code>QUAI_APNS_KEY_ID</Code>,{" "}
                <Code>QUAI_APNS_TEAM_ID</Code>
              </p>
              {!push.configured && <Callout tone="warn" icon="alert" title="Nothing is pushed">{pushOffline}</Callout>}
            </section>
            <section className="flex flex-col gap-3 border-t border-line pt-5">
              <Eyebrow>iPhones away from home</Eyebrow>
              <AwayRows access={access} />
              <p className="text-caption text-faint">
                Where your iPhones reach Quai Cloud when they're out, put in the pairing QR code:{" "}
                <Code>QUAI_CLOUD_PUBLIC_URL</Code>, and <Code>QUAI_CLOUD_PUBLIC_HEADERS</Code>{" "}
                if a proxy asks for them. The console's own address from outside is{" "}
                <Code>QUAI_CONSOLE_PUBLIC_URL</Code>, on Quai Home.
              </p>
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
      <PageBar title="Settings" subtitle="Your own Quai Cloud, as Quai Home links to it." />
      <PageBody>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <CloudPanel />
        </div>
      </PageBody>
    </>
  )
}
