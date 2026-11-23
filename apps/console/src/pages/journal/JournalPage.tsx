import { type JournalEntry, type JournalPage as Page, type JournalSource, journalSources } from "@quai/api"
import { useEffect, useRef, useState } from "react"
import { call, useLink } from "../../client.ts"
import { useLoad } from "../../load.ts"
import {
  Async,
  Button,
  Callout,
  cx,
  EmptyState,
  ErrorCallout,
  Icon,
  LogDay,
  LogLine,
  LogList,
  LogTag,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  PageBar,
  PageBody,
  Panel,
  Popover,
  SearchField,
  Segmented,
  SkeletonList,
  StatusDot
} from "../../ui"
import {
  byDay,
  heldLabel,
  historyQuery,
  type JournalFilters,
  levelTone,
  noFilters,
  sourceIcon,
  sourceName,
  sourcesLabel,
  timeLabel,
  visibleLines
} from "./feed.ts"

/** The live view asks for what's new this often. */
const pollMs = 2_000
/** Lines kept from the live view, newest last. */
const liveCap = 500
const pageSize = 100

const levels = [
  { value: "info", label: "All" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors" }
] as const

const subtitle = (paused: boolean) =>
  paused ? "Paused: new lines wait until you resume." : "What Quai did, live. Quai Home keeps 7 days of it."

/** `value`, once it stopped changing for `ms`. */
function useSettled<A>(value: A, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** The lines Quai Cloud took in since the page opened, polled every 2 s: oldest first, `fresh` the last batch. */
function useLiveLines() {
  const [live, setLive] = useState<{ readonly lines: ReadonlyArray<JournalEntry>; readonly fresh: ReadonlySet<string> }>({ lines: [], fresh: new Set() })
  useEffect(() => {
    let cursor: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const poll = () => {
      call((c) => c.consoleJournal.since({ query: cursor === undefined ? {} : { cursor } })).then((tail) => {
        const first = cursor === undefined
        cursor = tail.cursor
        if (tail.entries.length === 0 || stopped) return
        setLive((l) => ({ lines: [...l.lines, ...tail.entries].slice(-liveCap), fresh: first ? new Set() : new Set(tail.entries.map((e) => e.id)) }))
      }, () => undefined).finally(() => {
        if (!stopped) timer = setTimeout(poll, pollMs)
      })
    }
    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])
  return live
}

/** Whether the page is scrolled away from its newest lines. */
function useScrolledAway() {
  const [away, setAway] = useState(false)
  useEffect(() => {
    const onScroll = () => setAway(window.scrollY > 400)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  return away
}

/** The journal: what Quai did, newest on top, live, filtered by source, level, title and words. */
export function JournalPage() {
  const { epoch } = useLink()
  const [filters, setFilters] = useState<JournalFilters>(noFilters)
  const [search, setSearch] = useState("")
  const settledSearch = useSettled(search, 300)
  const applied = { ...filters, search: settledSearch }
  const key = JSON.stringify(historyQuery(applied))
  const history = useLoad(() => call((c) => c.consoleJournal.history({ query: { ...historyQuery(applied), limit: pageSize } })), [key, epoch])
  const live = useLiveLines()
  const [frozenAt, setFrozenAt] = useState<string | null>(null)
  const away = useScrolledAway()

  const pause = () => setFrozenAt(live.lines.at(-1)?.id ?? "")
  const jumpToLatest = () => {
    setFrozenAt(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const bySubject = (line: JournalEntry) =>
    line.subject !== undefined && setFilters((f) => ({ ...f, subject: { key: line.subject!, title: line.title ?? line.subject! } }))

  return (
    <>
      <PageBar title="Journal" subtitle={subtitle(frozenAt !== null)}>
        <LiveState paused={frozenAt !== null} />
        <Button variant="secondary" icon={frozenAt === null ? "pause" : "play"} onClick={frozenAt === null ? pause : jumpToLatest}>
          {frozenAt === null ? "Pause" : "Resume"}
        </Button>
      </PageBar>
      {/* Room at the bottom for "Jump to latest", over the last lines. */}
      <PageBody className="pb-24 md:pb-24">
        <FilterBar filters={filters} search={search} onFilters={setFilters} onSearch={setSearch} />
        <ErrorCallout error={history.error} title="Couldn't read the journal" />
        <Async state={history} loading={<Panel flush><SkeletonList count={6} /></Panel>}>
          {(page) => (
            <JournalHistory
              key={key}
              first={page}
              filters={applied}
              live={live}
              frozenAt={frozenAt}
              onSubject={bySubject}
            />
          )}
        </Async>
      </PageBody>
      <JumpToLatest held={visibleLines(live.lines, history.data?.entries ?? [], applied, frozenAt).held} away={away} onJump={jumpToLatest} />
    </>
  )
}

/** "● Live" while the page follows what comes in. */
function LiveState({ paused }: { paused: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 px-1 text-caption font-semibold", paused ? "text-muted" : "text-accent")}>
      <StatusDot tone={paused ? "neutral" : "accent"} pulse={!paused} />
      {paused ? "Paused" : "Live"}
    </span>
  )
}

/** Sources, level, words, and the title the page is narrowed to. */
function FilterBar({ filters, search, onFilters, onSearch }: {
  filters: JournalFilters
  search: string
  onFilters: (f: (filters: JournalFilters) => JournalFilters) => void
  onSearch: (search: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SourcePicker sources={filters.sources} onChange={(sources) => onFilters((f) => ({ ...f, sources }))} />
      <Segmented label="Level" value={filters.level} options={levels} onChange={(level) => onFilters((f) => ({ ...f, level }))} />
      {filters.subject !== null && (
        <Button variant="secondary" size="sm" icon="x" onClick={() => onFilters((f) => ({ ...f, subject: null }))}>
          {filters.subject.title}
        </Button>
      )}
      <SearchField
        className="w-full sm:ml-auto sm:w-64"
        placeholder="Search the journal"
        aria-label="Search the journal"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
    </div>
  )
}

/** Which sources to show: every one when none is picked. */
function SourcePicker({ sources, onChange }: { sources: ReadonlyArray<JournalSource>; onChange: (sources: ReadonlyArray<JournalSource>) => void }) {
  const toggle = (source: JournalSource) =>
    onChange(sources.includes(source) ? sources.filter((s) => s !== source) : [...sources, source])
  return (
    <Popover
      trigger={({ toggle: open }) => (
        <Button variant="secondary" size="sm" icon="server" onClick={open}>
          {sourcesLabel(sources)}
          <Icon name="chevronDown" size={13} className="text-muted" />
        </Button>
      )}
    >
      {() => (
        <>
          <MenuLabel>Sources</MenuLabel>
          {journalSources.map((source) => (
            <MenuItem key={source} icon={sourceIcon[source]} aria-pressed={sources.includes(source)} onClick={() => toggle(source)}>
              <span className="flex-1">{sourceName(source)}</span>
              {sources.includes(source) && <Icon name="check" size={14} className="text-accent" />}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon="reset" disabled={sources.length === 0} onClick={() => onChange([])}>All sources</MenuItem>
        </>
      )}
    </Popover>
  )
}

/** The first page and the older ones asked for, with what came in live on top. */
function JournalHistory({ first, filters, live, frozenAt, onSubject }: {
  first: Page
  filters: JournalFilters
  live: { readonly lines: ReadonlyArray<JournalEntry>; readonly fresh: ReadonlySet<string> }
  frozenAt: string | null
  onSubject: (line: JournalEntry) => void
}) {
  // Until an older page came, whether there is more is the first page's say.
  const [older, setOlder] = useState<{ readonly entries: ReadonlyArray<JournalEntry>; readonly more: boolean | null }>({ entries: [], more: null })
  const more = older.more ?? first.more
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const history = [...first.entries, ...older.entries]
  const { lines } = visibleLines(live.lines, history, filters, frozenAt)
  const now = useRef(Date.now()).current

  const loadOlder = () => {
    setLoading(true)
    const before = history.at(-1)?.id
    call((c) => c.consoleJournal.history({ query: { ...historyQuery(filters, before), limit: pageSize } }))
      .then((page) => {
        setOlder((o) => ({ entries: [...o.entries, ...page.entries], more: page.more }))
        setError(null)
      }, setError)
      .finally(() => setLoading(false))
  }

  return (
    <>
      {first.kept === "memory" && (
        <Callout tone="warn" icon="unlink" title="Only the last lines">
          Quai Home is offline, or too old to keep a journal: this is what Quai Cloud holds in memory. The 7-day history comes back with it.
        </Callout>
      )}
      {/* Clipped, not hidden: the day headings stay sticky. */}
      <Panel flush className="overflow-clip">
        <JournalLines lines={lines} now={now} fresh={live.fresh} onSubject={onSubject} />
      </Panel>
      <ErrorCallout error={error} title="Couldn't read older lines" />
      {more && (
        <div className="flex justify-center">
          <Button variant="secondary" icon="arrowDown" disabled={loading} onClick={loadOlder}>{loading ? "Loading…" : "Load older"}</Button>
        </div>
      )}
    </>
  )
}

function JournalLines({ lines, now, fresh, onSubject }: {
  lines: ReadonlyArray<JournalEntry>
  now: number
  fresh: ReadonlySet<string>
  onSubject: (line: JournalEntry) => void
}) {
  if (lines.length === 0) {
    return <EmptyState icon="journal" title="Nothing here yet">What Quai does shows here as it happens: webhooks, Live Activities, pushes, buttons pressed.</EmptyState>
  }
  return (
    <LogList>
      {byDay(lines, now).map((day) => (
        <div key={day.label}>
          <LogDay>{day.label}</LogDay>
          {day.lines.map((line) => <JournalRow key={line.id} line={line} fresh={fresh.has(line.id)} onSubject={() => onSubject(line)} />)}
        </div>
      ))}
    </LogList>
  )
}

/** One line: time, level, source, what happened; its title (a click narrows to it) and its iPhone. */
function JournalRow({ line, fresh, onSubject }: { line: JournalEntry; fresh: boolean; onSubject: () => void }) {
  return (
    <LogLine
      time={timeLabel(line.at)}
      tone={levelTone[line.level]}
      source={sourceName(line.source)}
      icon={sourceIcon[line.source]}
      fresh={fresh}
      aside={<RowTags line={line} onSubject={onSubject} />}
    >
      {line.text}
    </LogLine>
  )
}

function RowTags({ line, onSubject }: { line: JournalEntry; onSubject: () => void }) {
  if (line.title === undefined && line.deviceName === undefined) return null
  return (
    <>
      {line.deviceName !== undefined && <LogTag icon="phone">{line.deviceName}</LogTag>}
      {line.title !== undefined && line.subject !== undefined && (
        <LogTag icon="filter" title={`Only ${line.title}`} onClick={onSubject}>{line.title}</LogTag>
      )}
    </>
  )
}

/** Back to the newest lines: shown while paused with lines waiting, or scrolled away. */
function JumpToLatest({ held, away, onJump }: { held: number; away: boolean; onJump: () => void }) {
  if (held === 0 && !away) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <Button className="pointer-events-auto shadow-pop" icon="arrowUp" onClick={onJump}>
        {held > 0 ? `Jump to latest · ${heldLabel(held)}` : "Jump to latest"}
      </Button>
    </div>
  )
}
