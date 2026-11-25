import { type HomeProtocol, journalSourceNames, type ServiceCheck, type ServiceSetup } from "@quai/api"
import { type FormEvent, type ReactNode, useState } from "react"
import { callHome } from "../client.ts"
import { useLoad } from "../load.ts"
import { Async, Badge, Button, Code, ErrorCallout, Field, Icon, Input, Item, ItemList, Mono, PageBar, PageBody, Panel, SkeletonList, type Tone } from "../ui"

type Service = HomeProtocol.HomeService

/** What Quai does with each service, and where its key is. */
const about: Record<Service, { readonly use: string; readonly key: string; readonly example: string }> = {
  radarr: { use: "Films: downloads, releases, the To fix list.", key: "Radarr, Settings → General → API Key.", example: "http://radarr:7878" },
  sonarr: { use: "Series: downloads, episodes, the To fix list.", key: "Sonarr, Settings → General → API Key.", example: "http://sonarr:8989" },
  qbittorrent: { use: "Download progress on the Live Activities.", key: "qBittorrent's Web UI login, or none if it lets Quai Home in without one.", example: "http://qbittorrent:8080" },
  jellyfin: { use: "What's playing, and play/pause from the app.", key: "Jellyfin, Dashboard → API Keys.", example: "http://jellyfin:8096" },
  seerr: { use: "Requests to approve or decline from the app.", key: "Seerr, Settings → General → API Key.", example: "http://seerr:5055" },
  reclaimerr: { use: "Planned deletions, and keeping a title.", key: "Reclaimerr, Settings → Integrations: a token with candidates:manage.", example: "http://reclaimerr:8000" },
  cleanuparr: { use: "Stalled downloads it strikes, and sparing one.", key: "Cleanuparr, Settings → Account → API Key.", example: "http://cleanuparr:11011" },
  prowlarr: { use: "Alerts when it's down or reports a problem.", key: "Prowlarr, Settings → General → API Key.", example: "http://prowlarr:9696" }
}

const checkTones: Record<ServiceCheck["outcome"], Tone> = { ok: "ok", refused: "danger", unreachable: "danger", failed: "warn" }

/** "3 of 8 set" */
const subtitle = (list: ReadonlyArray<ServiceSetup> | null) =>
  list === null
    ? "Where Quai Home reaches each service, and its key"
    : `${list.filter((setup) => setup.source !== "none").length} of ${list.length} set · addresses and keys stay in Quai Home, never sent to Quai Cloud`

const secretName = (service: Service) => service === "qbittorrent" ? "Password" : "API key"

const secretPlaceholder = (setup: ServiceSetup) =>
  setup.hasSecret ? "Leave empty to keep the saved one" : setup.service === "qbittorrent" ? "Optional" : "Paste it here"

/** What each outcome reads as, in a pill. */
const checkLabels: Record<ServiceCheck["outcome"], string> = { ok: "Connected", refused: "Key refused", unreachable: "Unreachable", failed: "Error" }

/** "Connected · 6.0.4", or the outcome alone. */
const checkLabel = (check: ServiceCheck) => check.version === undefined ? checkLabels[check.outcome] : `${checkLabels[check.outcome]} · ${check.version}`

/** What reaching the service gave, as a pill: checked when the page opens, and after each save. The whole message on hover. */
function CheckStatus({ setup, check }: { setup: ServiceSetup; check: ServiceCheck | null }) {
  if (setup.source === "none") return <Badge>Not set</Badge>
  if (check === null) return <Badge>Checking…</Badge>
  return <span title={check.message}><Badge tone={checkTones[check.outcome]} dot>{checkLabel(check)}</Badge></span>
}

/** The address, and where it comes from when it isn't this page. */
function ServiceAddress({ setup }: { setup: ServiceSetup }): ReactNode {
  if (setup.url === undefined) return null
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Mono className="truncate">{setup.url}</Mono>
    </span>
  )
}

function ServiceForm({ setup, onSaved, onRemove }: { setup: ServiceSetup; onSaved: (check: ServiceCheck) => void; onRemove: () => void }) {
  const [url, setUrl] = useState(setup.url ?? setup.suggestedUrl ?? "")
  const [secret, setSecret] = useState("")
  const [username, setUsername] = useState(setup.username ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const qbittorrent = setup.service === "qbittorrent"

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = { url, ...(secret === "" ? {} : { secret }), ...(qbittorrent ? { username } : {}) }
      const saved = await callHome((api) => api.services.save({ params: { service: setup.service }, payload }))
      onSaved(saved.check)
    } catch (failure) {
      setError(failure)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-2xl flex-col gap-4">
      <ErrorCallout error={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Address" hint={<>As Quai Home reaches it.</>}>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={about[setup.service].example} required autoComplete="off" />
        </Field>
        {qbittorrent && (
          <Field label="User name">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Optional" autoComplete="off" />
          </Field>
        )}
        <Field label={secretName(setup.service)} hint={about[setup.service].key}>
          <Input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={secretPlaceholder(setup)} autoComplete="new-password" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>{saving ? "Checking…" : "Save and check"}</Button>
        {setup.source === "saved" && <Button type="button" variant="danger" icon="trash" className="ml-auto" onClick={onRemove}>Remove</Button>}
      </div>
    </form>
  )
}

/**
 * The row's one action, the same on every row: set up or edit, which opens the form below. A
 * service the environment sets says so in its place.
 */
function ServiceAction({ setup, editing, onToggle }: { setup: ServiceSetup; editing: boolean; onToggle: () => void }) {
  if (setup.source === "environment") return <span title="Set by Quai Home's environment variables"><Badge tone="info">Env</Badge></span>
  return (
    <Button variant="ghost" size="sm" aria-expanded={editing} onClick={onToggle}>
      {actionLabel(setup, editing)}
      <Icon name="chevronDown" size={14} className={editing ? "rotate-180 transition-transform" : "transition-transform"} />
    </Button>
  )
}

const actionLabel = (setup: ServiceSetup, editing: boolean) => editing ? "Close" : setup.source === "none" ? "Set up" : "Edit"

/** One service: its address, whether Quai Home reaches it, and its form when open. */
function ServiceRow({ setup, onChanged }: { setup: ServiceSetup; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [fresh, setFresh] = useState<ServiceCheck | null>(null)
  const checked = useLoad(
    () => setup.source === "none" ? Promise.resolve(null) : callHome((api) => api.services.check({ params: { service: setup.service } })),
    [setup.source, setup.url]
  )
  const remove = () => {
    if (!window.confirm(`Remove ${journalSourceNames[setup.service]}? Quai leaves out what it does until it's set again.`)) return
    void callHome((api) => api.services.remove({ params: { service: setup.service } })).then(() => {
      setEditing(false)
      setFresh(null)
      onChanged()
    }, checked.setError)
  }
  const saved = (result: ServiceCheck) => {
    setFresh(result)
    setEditing(false)
    onChanged()
  }

  return (
    <Item
      title={journalSourceNames[setup.service]}
      subtitle={about[setup.service].use}
      detail={setup.url === undefined ? undefined : <ServiceAddress setup={setup} />}
      state={<CheckStatus setup={setup} check={fresh ?? checked.data} />}
      action={<ServiceAction setup={setup} editing={editing} onToggle={() => setEditing(!editing)} />}
      open={editing}
    >
      {editing && <ServiceForm setup={setup} onSaved={saved} onRemove={remove} />}
    </Item>
  )
}

export function ServicesPage() {
  const services = useLoad(() => callHome((api) => api.services.list()), [])
  return (
    <>
      <PageBar title="Services" subtitle={subtitle(services.data)} />
      <PageBody>
        <ErrorCallout error={services.error} />
        <Panel flush>
          <Async state={services} loading={<SkeletonList count={4} />}>
            {(list) => <ItemList>{list.map((setup) => <ServiceRow key={setup.service} setup={setup} onChanged={services.refresh} />)}</ItemList>}
          </Async>
        </Panel>
        <EnvironmentNote list={services.data} />
      </PageBody>
    </>
  )
}

/** Services set by Quai Home's environment are read-only here: where to change them. */
function EnvironmentNote({ list }: { list: ReadonlyArray<ServiceSetup> | null }) {
  if (list === null || !list.some((setup) => setup.source === "environment")) return null
  return (
    <p className="flex gap-2 text-caption text-muted">
      <Icon name="info" size={14} className="mt-0.5 shrink-0" />
      <span><Badge tone="info">Env</Badge> services are set by Quai Home's environment variables (<Code>QUAI_RADARR_URL</Code>…), which win over this page: change them there.</span>
    </p>
  )
}
