import type { EpisodeChoice, Fix, FixAction, Fixes, ImportPreview, Release } from "@quai/api"
import { useState } from "react"
import { call, setFixCount, useHome } from "../client.ts"
import { duration, minutesSince } from "../format.ts"
import { useLoad } from "../load.ts"
import {
  Async,
  Badge,
  Button,
  Callout,
  type Column,
  cx,
  DataTable,
  EmptyState,
  ErrorCallout,
  errorText,
  Eyebrow,
  HomeOfflineState,
  Icon,
  type IconName,
  IconTile,
  MediaItem,
  MediaList,
  MenuItem,
  MenuLabel,
  type Notice,
  PageBar,
  PageBody,
  Panel,
  Popover,
  PosterThumb,
  Select,
  Skeleton,
  SkeletonList,
  Toast,
  WithSidebar
} from "../ui"

const serviceName = { radarr: "Radarr", sonarr: "Sonarr", reclaimerr: "Reclaimerr" } as const

/** Each kind's glyph and colour, as in the app. */
const kinds: Record<Fix["kind"], { readonly icon: IconName; readonly color: string }> = {
  scheduledDeletion: { icon: "trash", color: "text-fix" },
  noSource: { icon: "search", color: "text-search" },
  importBlocked: { icon: "alert", color: "text-danger" }
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────────────

/** "in 5 days", "tomorrow", "at the next cleanup" */
const when = (deletesAt: number) => {
  const left = deletesAt - Date.now() / 1000
  if (left <= 0) return "at the next cleanup"
  if (left < 86_400) return "within a day"
  const days = Math.round(left / 86_400)
  return days === 1 ? "tomorrow" : `in ${days} days`
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

/** "Radarr · Not monitored · for 3 h" */
const fixDetail = (fix: Fix) =>
  [serviceName[fix.service], fix.reason, fix.kind === "noSource" && fix.since !== undefined ? `for ${duration(minutesSince(fix.since))}` : null]
    .filter(Boolean)
    .join(" · ")

const size = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

const age = (hours: number) => hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`

const episodeCode = (e: EpisodeChoice) => `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`

const episodeLabel = (e: EpisodeChoice) => `${episodeCode(e)}${e.title ? ` · ${e.title}` : ""}`

/** "EZTV · English · 4.3 GB · 12 seeders · 1 d" */
const releaseFacts = (r: Release) =>
  [r.indexer, r.languages.join(", "), size(r.sizeBytes), r.seeders === undefined ? null : `${r.seeders} seeders`, age(r.ageHours)]
    .filter(Boolean)
    .join(" · ")

const subtitle = (list: Fixes | null) => {
  if (list === null) return "Found by fixed rules, no AI. Each one has its fix."
  if (list.items.length === 0) return "Nothing to fix"
  return `${list.items.length} to fix · each one has its fix${list.hidden > 0 ? ` · ${list.hidden} hidden` : ""}`
}

/** "Radarr and Sonarr didn't answer: their problems are missing." */
const unavailableText = (services: ReadonlyArray<Fix["service"]>) =>
  `${services.map((s) => serviceName[s]).join(" and ")} didn't answer: ${services.length === 1 ? "its" : "their"} problems are missing.`

// ── Page ─────────────────────────────────────────────────────────────────────────────────────────

/** Which row has a panel open under it, and which one. */
type Open = { readonly id: string; readonly panel: OpenPanel } | null
type OpenPanel = "releases" | "import"

/** Runs a fix's action, then says `done` and drops the row; the next read says whether it's really gone. */
type Act = (fix: Fix, run: () => Promise<unknown>, done: string) => Promise<void>

export function FixesPage() {
  const { epoch } = useHome()
  const fixes = useLoad(() => call((c) => c.consoleFixes.list()).then((list) => {
    setFixCount(list.items.length)
    return list
  }), [epoch])
  const [open, setOpen] = useState<Open>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const unavailable = fixes.data?.unavailable ?? []

  const act: Act = async (fix, run, done) => {
    try {
      await run()
      setNotice({ ok: true, text: `${done}: ${fix.title}` })
      setOpen(null)
      fixes.setData((list) => ({ ...list, items: list.items.filter((f) => f.id !== fix.id) }))
      fixes.refresh()
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) })
    }
  }

  return (
    <>
      <PageBar title="To fix" subtitle={subtitle(fixes.data)}>
        <Button variant="secondary" icon="refresh" onClick={fixes.refresh}>Refresh</Button>
      </PageBar>
      <PageBody>
        <ErrorCallout unlessOffline error={fixes.error} title="Couldn't read the list" />
        {unavailable.length > 0 && <Callout tone="warn" icon="unlink">{unavailableText(unavailable)}</Callout>}
        <WithSidebar sidebar={<WatchedRules />}>
          <Panel flush>
            <Async
              state={fixes}
              loading={<SkeletonList count={3} />}
              offline={<HomeOfflineState what="Radarr, Sonarr and Reclaimerr are read through Quai Home: they" />}
            >
              {(list) => <FixList list={list} open={open} setOpen={setOpen} act={act} />}
            </Async>
          </Panel>
        </WithSidebar>
      </PageBody>
      <Toast notice={notice} onDone={() => setNotice(null)} />
    </>
  )
}

function FixList({ list, open, setOpen, act }: { list: Fixes; open: Open; setOpen: (open: Open) => void; act: Act }) {
  if (list.items.length === 0) {
    return (
      <EmptyState icon="check" title="Nothing to fix">
        No blocked import, every title has a source, and Reclaimerr has nothing scheduled.{list.hidden > 0 && ` ${list.hidden} hidden for now.`}
      </EmptyState>
    )
  }
  return (
    <MediaList>
      {list.items.map((fix) => (
        <FixRow
          key={fix.id}
          fix={fix}
          panel={open?.id === fix.id ? open.panel : null}
          onPanel={(panel) => setOpen(panel === null ? null : { id: fix.id, panel })}
          act={act}
        />
      ))}
    </MediaList>
  )
}

/** One problem: what's wrong, its fixes, and the panel one of them opened under it. */
function FixRow({ fix, panel, onPanel, act }: { fix: Fix; panel: OpenPanel | null; onPanel: (panel: OpenPanel | null) => void; act: Act }) {
  const kind = kinds[fix.kind]
  return (
    <MediaItem
      poster={<PosterThumb src={fix.posterUrl} badge={kind.icon} badgeClassName={kind.color} fallback={<IconTile icon={kind.icon} className={kind.color} />} />}
      title={fixTitle(fix)}
      detail={fixDetail(fix)}
      actions={<FixActions fix={fix} act={act} onToggle={(next) => onPanel(panel === next ? null : next)} />}
    >
      {panel === "releases" && (
        <ReleasesPanel fix={fix} onClose={() => onPanel(null)} onGrabbed={(title) => void act(fix, () => Promise.resolve(), `Grabbed ${title}`)} />
      )}
      {panel === "import" && (
        <ImportPanel fix={fix} onClose={() => onPanel(null)} onImported={() => void act(fix, () => Promise.resolve(), "Import started")} />
      )}
    </MediaItem>
  )
}

/** The fixes a problem offers, each one only when the problem has it. */
function FixActions({ fix, act, onToggle }: { fix: Fix; act: Act; onToggle: (panel: OpenPanel) => void }) {
  const id = { params: { id: fix.id } }
  const has = (action: FixAction) => fix.actions.includes(action)
  const keep = () => act(fix, () => call((c) => c.consoleFixes.keep(id)), "Kept: Reclaimerr won't delete it")
  const dismiss = () => act(fix, () => call((c) => c.consoleFixes.dismiss(id)), "Reclaimerr goes ahead")
  const snooze = (days?: number) =>
    void act(fix, () => call((c) => c.consoleFixes.snooze({ ...id, payload: days === undefined ? {} : { days } })), "Hidden for now")
  const remove = (blocklist: boolean) => {
    if (!window.confirm(`Remove “${fix.download?.release ?? fix.title}” from the queue and the download client${blocklist ? ", and blocklist it" : ""}?`)) return
    void act(fix, () => call((c) => c.consoleFixes.remove({ ...id, payload: { blocklist } })), "Removed from the queue")
  }

  return (
    <>
      {has("keep") && <Button icon="shield" onClick={keep}>Keep</Button>}
      {has("dismiss") && <Button variant="secondary" onClick={dismiss}>Let it go</Button>}
      {has("searchReleases") && <Button icon="search" onClick={() => onToggle("releases")}>Search releases</Button>}
      {has("snooze") && (
        <Popover align="right" trigger={({ toggle }) => <Button variant="secondary" icon="moon" onClick={toggle}>Ignore and wait</Button>}>
          {(close) => (
            <>
              <MenuLabel>Hide it</MenuLabel>
              <MenuItem onClick={() => { close(); snooze() }}>Until a release is grabbed</MenuItem>
              <MenuItem onClick={() => { close(); snooze(1) }}>For a day</MenuItem>
              <MenuItem onClick={() => { close(); snooze(7) }}>For a week</MenuItem>
            </>
          )}
        </Popover>
      )}
      {has("importAnyway") && <Button icon="download" onClick={() => onToggle("import")}>Import anyway</Button>}
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
    </>
  )
}

// ── Panels under a row ───────────────────────────────────────────────────────────────────────────

const releaseColumns: ReadonlyArray<Column<Release>> = [
  { header: "Release", primary: true, cell: (r) => <ReleaseCell release={r} /> },
  { header: "Quality", cell: (r) => <Badge tone={r.rejected ? "neutral" : "accent"}>{r.quality}</Badge> }
]

function ReleaseCell({ release: r }: { release: Release }) {
  return (
    <span className="block min-w-0 py-2">
      <span className="block font-medium wrap-anywhere">{r.title}</span>
      <span className="mt-0.5 block text-caption text-muted tabular-nums">{releaseFacts(r)}</span>
      {r.rejected && <span className="mt-0.5 block text-caption text-warn-text" title={r.rejections.join("\n")}>{r.rejections[0]}</span>}
    </span>
  )
}

/** The releases the indexers have for a title without a file, to grab one. */
function ReleasesPanel({ fix, onGrabbed, onClose }: { fix: Fix; onGrabbed: (title: string) => void; onClose: () => void }) {
  const releases = useLoad(() => call((c) => c.consoleFixes.releases({ params: { id: fix.id } })).then((r) => r.items), [fix.id])
  const [grabbing, setGrabbing] = useState<string | null>(null)

  const grab = async (release: Release) => {
    if (release.rejected && !window.confirm(`${serviceName[fix.service]} rejected this release:\n\n${release.rejections.join("\n")}\n\nGrab it anyway?`)) return
    setGrabbing(release.guid)
    try {
      await call((c) => c.consoleFixes.grab({ params: { id: fix.id }, payload: { guid: release.guid, indexerId: release.indexerId } }))
      onGrabbed(release.title)
    } catch (e) {
      releases.setError(e)
    } finally {
      setGrabbing(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-bg/40 pt-4 pb-2">
      <div className="flex items-center gap-3 px-5">
        <Eyebrow className="flex-1">Releases{releases.data !== null && ` · ${releases.data.length}`}</Eyebrow>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      {releases.error !== null && <div className="px-5"><ErrorCallout error={releases.error} /></div>}
      <Async
        state={releases}
        loading={<p className="flex items-center gap-2 px-5 pb-3 text-body text-muted"><Icon name="search" size={14} />Asking the indexers… it can take up to a minute.</p>}
        failed={() => null}
      >
        {(items) => (
          <DataTable
            columns={releaseColumns}
            rows={items}
            rowKey={(r) => r.guid}
            actions={(r) => (
              <Button size="sm" variant={r.rejected ? "secondary" : "primary"} icon="download" disabled={grabbing !== null} onClick={() => grab(r)}>
                {grabbing === r.guid ? "Grabbing…" : "Grab"}
              </Button>
            )}
            empty={<EmptyState compact icon="search" title="No release found">None of the indexers has this title right now. Ignore it and wait, it comes back if nothing is grabbed.</EmptyState>}
          />
        )}
      </Async>
    </div>
  )
}

/** What Import anyway would import: the files, why they were refused, the episode to choose. */
function ImportPanel({ fix, onImported, onClose }: { fix: Fix; onImported: () => void; onClose: () => void }) {
  const preview = useLoad(() => call((c) => c.consoleFixes.importPreview({ params: { id: fix.id } })), [fix.id])
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [importing, setImporting] = useState(false)

  const run = async (files: ImportPreview["files"]) => {
    const reasons = [...new Set(files.flatMap((f) => f.rejections))]
    if (!window.confirm(`Import anyway, past what ${serviceName[fix.service]} said?\n\n${reasons.join("\n") || "No rejection."}`)) return
    setImporting(true)
    try {
      const assignments = Object.entries(chosen).map(([file, id]) => ({ file, episodeIds: [id] }))
      await call((c) => c.consoleFixes.import({ params: { id: fix.id }, payload: { assignments } }))
      onImported()
    } catch (e) {
      preview.setError(e)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-bg/40 px-5 pt-4 pb-4">
      <Eyebrow>Import anyway</Eyebrow>
      <ErrorCallout error={preview.error} />
      <Async state={preview} loading={<Skeleton className="h-10 w-full" />} failed={() => null}>
        {({ files, episodes }) => (
          <>
            {files.map((file) => (
              <ImportFile
                key={file.file}
                file={file}
                episodes={episodes}
                chosen={chosen[file.file]}
                onChoose={(episode) => setChosen({ ...chosen, [file.file]: episode })}
              />
            ))}
            <div className="flex gap-2">
              <Button icon="download" disabled={importing || !ready(files, chosen)} onClick={() => run(files)}>{importing ? "Importing…" : "Import"}</Button>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </Async>
    </div>
  )
}

/** Whether there are files to import and each one that needs an episode has one chosen. */
const ready = (files: ImportPreview["files"], chosen: Record<string, number>) =>
  files.length > 0 && files.every((f) => !f.needsEpisodes || chosen[f.file] !== undefined)

/** One file Import anyway would import: its quality and episodes, why it was refused, the episode to pick. */
function ImportFile({ file, episodes, chosen, onChoose }: {
  file: ImportPreview["files"][number]
  episodes: ImportPreview["episodes"]
  chosen: number | undefined
  onChoose: (episodeId: number) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-body font-medium" title={file.file}>{file.file}</span>
        {file.quality && <Badge>{file.quality}</Badge>}
        {file.episodes.map((e) => <Badge key={e} tone="accent">{e}</Badge>)}
      </div>
      {file.rejections.map((r) => <p key={r} className="flex items-start gap-2 text-small text-warn-text"><Icon name="alert" size={13} className="mt-0.5" />{r}</p>)}
      {file.needsEpisodes && (
        <label className="flex flex-wrap items-center gap-3 text-body">
          <span className="text-muted">Choose the episode</span>
          <span className="min-w-56">
            <Select value={chosen ?? ""} onChange={(e) => onChoose(Number(e.target.value))}>
              <option value="" disabled>Episode…</option>
              {episodes.map((e) => <option key={e.id} value={e.id}>{episodeLabel(e)}</option>)}
            </Select>
          </span>
        </label>
      )}
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────────────────────────

const rules = [
  { icon: "alert", color: "text-danger", title: "Import blocked", text: "A finished download Radarr or Sonarr won't import." },
  { icon: "search", color: "text-search", title: "No source for 2 h", text: "Monitored, still without a file, nothing grabbed 2 hours after it was added or came out." },
  { icon: "trash", color: "text-fix", title: "Scheduled deletions", text: "What Reclaimerr is going to delete on its own." }
] as const

/** The fixed rules that find the problems. */
function WatchedRules() {
  return (
    <Panel title="What's watched" description="Fixed rules, checked each time this list is read.">
      <ul className="flex flex-col divide-y divide-line">
        {rules.map((r) => (
          <li key={r.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <Icon name={r.icon} size={16} className={cx("mt-0.5", r.color)} />
            <div>
              <p className="text-item font-semibold">{r.title}</p>
              <p className="mt-0.5 text-small leading-relaxed text-muted">{r.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
