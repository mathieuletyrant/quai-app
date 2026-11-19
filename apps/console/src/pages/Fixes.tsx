import type { EpisodeChoice, Fix, FixAction, ImportPreview, Release } from "@quai/api"
import { useCallback, useEffect, useState } from "react"
import { call, isHomeOffline, setFixCount, useHome } from "../client.ts"
import {
  Badge,
  Button,
  Callout,
  type Column,
  cx,
  DataTable,
  EmptyState,
  errorText,
  Eyebrow,
  HomeOfflineState,
  Icon,
  type IconName,
  MenuItem,
  MenuLabel,
  type Notice,
  PageBar,
  PageBody,
  Panel,
  Popover,
  Select,
  Skeleton,
  Toast
} from "../ui.tsx"

const serviceName = { radarr: "Radarr", sonarr: "Sonarr", reclaimerr: "Reclaimerr" } as const

/** Each kind's glyph and colour, as in the app. */
const kinds: Record<Fix["kind"], { readonly icon: IconName; readonly color: string }> = {
  scheduledDeletion: { icon: "trash", color: "text-fix" },
  noSource: { icon: "search", color: "text-search" },
  importBlocked: { icon: "alert", color: "text-danger" }
}

const days = (seconds: number) => Math.round(seconds / 86_400)

/** "in 5 days", "tomorrow", "at the next cleanup" */
const when = (deletesAt: number) => {
  const left = deletesAt - Date.now() / 1000
  if (left <= 0) return "at the next cleanup"
  if (left < 86_400) return "within a day"
  const d = days(left)
  return d === 1 ? "tomorrow" : `in ${d} days`
}

/** "3 h", "2 days" */
const elapsed = (since: number) => {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - since) / 60))
  return minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`
}

const fixTitle = (fix: Fix) => {
  switch (fix.kind) {
    case "scheduledDeletion":
      return `${fix.title} will be ${fix.deletion?.operation === "move" ? "moved" : "deleted"} ${when(fix.deletion?.deletesAt ?? 0)}`
    case "noSource":
      return `${fix.title}, still without a file`
    case "importBlocked":
      return `Import blocked · ${fix.title}`
  }
}

const fixDetail = (fix: Fix) =>
  [serviceName[fix.service], fix.reason, fix.kind === "noSource" && fix.since !== undefined ? `for ${elapsed(fix.since)}` : null]
    .filter(Boolean)
    .join(" · ")

const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

const age = (hours: number) => hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`

const episodeCode = (e: EpisodeChoice) => `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`

/** "EZTV · English · 4.3 GB · 12 seeders · 1 d" */
const releaseFacts = (r: Release) =>
  [r.indexer, r.languages.join(", "), size(r.sizeBytes), r.seeders === undefined ? null : `${r.seeders} seeders`, age(r.ageHours)]
    .filter(Boolean)
    .join(" · ")

const releaseColumns: ReadonlyArray<Column<Release>> = [
  {
    header: "Release",
    primary: true,
    cell: (r) => (
      <span className="block min-w-0 py-2">
        <span className="block font-medium [overflow-wrap:anywhere]">{r.title}</span>
        <span className="mt-0.5 block text-[12px] text-muted tabular-nums">{releaseFacts(r)}</span>
        {r.rejected && <span className="mt-0.5 block text-[12px] text-warn-text" title={r.rejections.join("\n")}>{r.rejections[0]}</span>}
      </span>
    )
  },
  { header: "Quality", cell: (r) => <Badge tone={r.rejected ? "neutral" : "accent"}>{r.quality}</Badge> }
]

/** The releases the indexers have for a title without a file, to grab one. */
function ReleasesPanel({ fix, onGrabbed, onClose }: { fix: Fix; onGrabbed: (title: string) => void; onClose: () => void }) {
  const [releases, setReleases] = useState<ReadonlyArray<Release> | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [grabbing, setGrabbing] = useState<string | null>(null)

  useEffect(() => {
    call((c) => c.consoleFixes.releases({ params: { id: fix.id } })).then((r) => setReleases(r.items), setError)
  }, [fix.id])

  const grab = async (release: Release) => {
    if (release.rejected && !window.confirm(`${serviceName[fix.service]} rejected this release:\n\n${release.rejections.join("\n")}\n\nGrab it anyway?`)) return
    setGrabbing(release.guid)
    try {
      await call((c) => c.consoleFixes.grab({ params: { id: fix.id }, payload: { guid: release.guid, indexerId: release.indexerId } }))
      onGrabbed(release.title)
    } catch (e) {
      setError(e)
    } finally {
      setGrabbing(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-bg/40 pt-4 pb-2">
      <div className="flex items-center gap-3 px-5">
        <Eyebrow className="flex-1">Releases{releases !== null && ` · ${releases.length}`}</Eyebrow>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      {error !== null && <div className="px-5"><Callout tone="danger" icon="alert">{errorText(error)}</Callout></div>}
      {releases === null && error === null && (
        <p className="flex items-center gap-2 px-5 pb-3 text-[13px] text-muted"><Icon name="search" size={14} />Asking the indexers… it can take up to a minute.</p>
      )}
      {releases !== null && (
        <DataTable
          columns={releaseColumns}
          rows={releases}
          rowKey={(r) => r.guid}
          actions={(r) => (
            <Button size="sm" variant={r.rejected ? "secondary" : "primary"} icon="download" disabled={grabbing !== null} onClick={() => grab(r)}>
              {grabbing === r.guid ? "Grabbing…" : "Grab"}
            </Button>
          )}
          empty={<EmptyState compact icon="search" title="No release found">None of the indexers has this title right now. Ignore it and wait, it comes back if nothing is grabbed.</EmptyState>}
        />
      )}
    </div>
  )
}

/** What Import anyway would import: the files, why they were refused, the episode to choose. */
function ImportPanel({ fix, onImported, onClose }: { fix: Fix; onImported: () => void; onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    call((c) => c.consoleFixes.importPreview({ params: { id: fix.id } })).then(setPreview, setError)
  }, [fix.id])

  const missingChoice = preview?.files.some((f) => f.needsEpisodes && chosen[f.file] === undefined) ?? true
  const run = async () => {
    if (preview === null) return
    const reasons = [...new Set(preview.files.flatMap((f) => f.rejections))]
    if (!window.confirm(`Import anyway, past what ${serviceName[fix.service]} said?\n\n${reasons.join("\n") || "No rejection."}`)) return
    setImporting(true)
    try {
      const assignments = Object.entries(chosen).map(([file, id]) => ({ file, episodeIds: [id] }))
      await call((c) => c.consoleFixes.import({ params: { id: fix.id }, payload: { assignments } }))
      onImported()
    } catch (e) {
      setError(e)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-bg/40 px-5 pt-4 pb-4">
      <Eyebrow>Import anyway</Eyebrow>
      {error !== null && <Callout tone="danger" icon="alert">{errorText(error)}</Callout>}
      {preview === null && error === null && <Skeleton className="h-10 w-full" />}
      {preview?.files.map((file) => (
        <div key={file.file} className="flex flex-col gap-2 rounded-card border border-line bg-panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={file.file}>{file.file}</span>
            {file.quality && <Badge>{file.quality}</Badge>}
            {file.episodes.map((e) => <Badge key={e} tone="accent">{e}</Badge>)}
          </div>
          {file.rejections.map((r) => <p key={r} className="flex items-start gap-2 text-[12.5px] text-warn-text"><Icon name="alert" size={13} className="mt-0.5" />{r}</p>)}
          {file.needsEpisodes && (
            <label className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="text-muted">Choose the episode</span>
              <span className="min-w-56">
                <Select value={chosen[file.file] ?? ""} onChange={(e) => setChosen({ ...chosen, [file.file]: Number(e.target.value) })}>
                  <option value="" disabled>Episode…</option>
                  {preview.episodes.map((e) => <option key={e.id} value={e.id}>{episodeCode(e)}{e.title ? ` · ${e.title}` : ""}</option>)}
                </Select>
              </span>
            </label>
          )}
        </div>
      ))}
      {preview !== null && (
        <div className="flex gap-2">
          <Button icon="download" disabled={importing || missingChoice || preview.files.length === 0} onClick={run}>{importing ? "Importing…" : "Import"}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </div>
  )
}

type Open = { readonly id: string; readonly panel: "releases" | "import" } | null

function FixRow({ fix, open, setOpen, act }: {
  fix: Fix
  open: Open
  setOpen: (open: Open) => void
  act: (fix: Fix, run: () => Promise<unknown>, done: string) => Promise<void>
}) {
  const kind = kinds[fix.kind]
  const id = { params: { id: fix.id } }
  const has = (action: FixAction) => fix.actions.includes(action)
  const remove = (blocklist: boolean) => {
    if (!window.confirm(`Remove “${fix.download?.release ?? fix.title}” from the queue and the download client${blocklist ? ", and blocklist it" : ""}?`)) return
    void act(fix, () => call((c) => c.consoleFixes.remove({ ...id, payload: { blocklist } })), "Removed from the queue")
  }
  const snooze = (days?: number) =>
    act(fix, () => call((c) => c.consoleFixes.snooze({ ...id, payload: days === undefined ? {} : { days } })), "Hidden for now")

  return (
    <li className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-[10px] bg-bg", kind.color)}><Icon name={kind.icon} size={18} strokeWidth={2.1} /></span>
        <div className="min-w-[min(100%,14rem)] flex-1">
          <p className="text-[14.5px] font-semibold [overflow-wrap:anywhere]">{fixTitle(fix)}</p>
          <p className="mt-0.5 text-[13px] text-muted [overflow-wrap:anywhere]">{fixDetail(fix)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {has("keep") && <Button icon="shield" onClick={() => act(fix, () => call((c) => c.consoleFixes.keep(id)), "Kept: Reclaimerr won't delete it")}>Keep</Button>}
          {has("dismiss") && <Button variant="secondary" onClick={() => act(fix, () => call((c) => c.consoleFixes.dismiss(id)), "Reclaimerr goes ahead")}>Let it go</Button>}
          {has("searchReleases") && (
            <Button icon="search" onClick={() => setOpen(open?.id === fix.id && open.panel === "releases" ? null : { id: fix.id, panel: "releases" })}>Search releases</Button>
          )}
          {has("snooze") && (
            <Popover align="right" trigger={({ toggle }) => <Button variant="secondary" icon="moon" onClick={toggle}>Ignore and wait</Button>}>
              {(close) => (
                <>
                  <MenuLabel>Hide it</MenuLabel>
                  <MenuItem onClick={() => { close(); void snooze() }}>Until a release is grabbed</MenuItem>
                  <MenuItem onClick={() => { close(); void snooze(1) }}>For a day</MenuItem>
                  <MenuItem onClick={() => { close(); void snooze(7) }}>For a week</MenuItem>
                </>
              )}
            </Popover>
          )}
          {has("importAnyway") && (
            <Button icon="download" onClick={() => setOpen(open?.id === fix.id && open.panel === "import" ? null : { id: fix.id, panel: "import" })}>Import anyway</Button>
          )}
          {has("remove") && (
            <Popover align="right" trigger={({ toggle }) => <Button variant={has("importAnyway") ? "secondary" : "danger"} icon="trash" onClick={toggle}>Remove</Button>}>
              {(close) => (
                <>
                  <MenuItem icon="trash" onClick={() => { close(); remove(false) }}>Remove from the queue</MenuItem>
                  <MenuItem danger icon="x" onClick={() => { close(); remove(true) }}>Remove and blocklist</MenuItem>
                </>
              )}
            </Popover>
          )}
        </div>
      </div>
      {open?.id === fix.id && open.panel === "releases" && (
        <ReleasesPanel fix={fix} onClose={() => setOpen(null)} onGrabbed={(title) => void act(fix, () => Promise.resolve(), `Grabbed ${title}`)} />
      )}
      {open?.id === fix.id && open.panel === "import" && (
        <ImportPanel fix={fix} onClose={() => setOpen(null)} onImported={() => void act(fix, () => Promise.resolve(), "Import started")} />
      )}
    </li>
  )
}

const rules = [
  { icon: "alert", color: "text-danger", title: "Import blocked", text: "A finished download Radarr or Sonarr won't import." },
  { icon: "search", color: "text-search", title: "No source for 2 h", text: "Monitored, still without a file, nothing grabbed 2 hours after it was added or came out." },
  { icon: "trash", color: "text-fix", title: "Scheduled deletions", text: "What Reclaimerr is going to delete on its own." }
] as const

export function FixesPage() {
  const [fixes, setFixes] = useState<ReadonlyArray<Fix> | null>(null)
  const [unavailable, setUnavailable] = useState<ReadonlyArray<string>>([])
  const [hidden, setHidden] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<Open>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const { epoch } = useHome()

  const refresh = useCallback(() => {
    call((c) => c.consoleFixes.list()).then((list) => {
      setFixes(list.items)
      setUnavailable(list.unavailable)
      setHidden(list.hidden)
      setFixCount(list.items.length)
      setError(null)
    }, setError)
  }, [])
  useEffect(() => refresh(), [refresh, epoch])

  const act = async (fix: Fix, run: () => Promise<unknown>, done: string) => {
    try {
      await run()
      setNotice({ ok: true, text: `${done}: ${fix.title}` })
      setOpen(null)
      // Drop it at once; the next read says whether it's really gone.
      setFixes((list) => list?.filter((f) => f.id !== fix.id) ?? null)
      refresh()
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) })
    }
  }

  const offline = isHomeOffline(error)
  const count = fixes?.length ?? 0
  return (
    <>
      <PageBar
        title="To fix"
        subtitle={fixes === null ? "Found by fixed rules, no AI. Each one has its fix." : count === 0 ? "Nothing to fix" : `${count} to fix · each one has its fix${hidden > 0 ? ` · ${hidden} hidden` : ""}`}
      >
        <Button variant="secondary" icon="refresh" onClick={refresh}>Refresh</Button>
      </PageBar>
      <PageBody>
        {error !== null && !offline && <Callout tone="danger" icon="alert" title="Couldn't read the list">{errorText(error)}</Callout>}
        {unavailable.length > 0 && (
          <Callout tone="warn" icon="unlink">
            {unavailable.map((s) => serviceName[s as keyof typeof serviceName] ?? s).join(" and ")} didn't answer: {unavailable.length === 1 ? "its" : "their"} problems are missing.
          </Callout>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Panel flush>
            {offline && fixes === null
              ? <HomeOfflineState what="Radarr, Sonarr and Reclaimerr are read through Quai Home: they" />
              : fixes === null
              ? <div className="flex flex-col gap-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              : fixes.length === 0
              ? (
                <EmptyState icon="check" title="Nothing to fix">
                  No blocked import, every title has a source, and Reclaimerr has nothing scheduled.{hidden > 0 && ` ${hidden} hidden for now.`}
                </EmptyState>
              )
              : <ul className="divide-y divide-line">{fixes.map((fix) => <FixRow key={fix.id} fix={fix} open={open} setOpen={setOpen} act={act} />)}</ul>}
          </Panel>
          <Panel title="What's watched" description="Fixed rules, checked each time this list is read.">
            <ul className="flex flex-col divide-y divide-line">
              {rules.map((r) => (
                <li key={r.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <Icon name={r.icon} size={16} className={cx("mt-0.5", r.color)} />
                  <div>
                    <p className="text-[13.5px] font-semibold">{r.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{r.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </PageBody>
      <Toast notice={notice} onDone={() => setNotice(null)} />
    </>
  )
}
