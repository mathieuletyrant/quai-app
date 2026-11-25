/**
 * Space back (GLOSSARY): when a title's room on the disk really comes back. With hardlinks, the
 * library's copy and every torrent seeding the same files (cross-seeds too) are one set of files:
 * the space comes back when the last of them goes, and only then. Pure: the caller reads the
 * services, this decides. Whatever Quai can't be sure of gives no space at all: a row says "+X GB"
 * only when its own moment is surely the last copy going.
 */
import type { CleanupTiming } from "../integrations/cleanuparr.ts"

/** A title as the library holds it: `movie:<radarr id>`, `series:<sonarr id>`, a season `series:<id>:s<n>`. */
export type TitleKey = string

/** A deletion Reclaimerr plans, as space back needs it. */
export interface DeletionInput {
  readonly candidateId: number
  /** As Reclaimerr names it: "Chainsaw Man – Le Film : L'arc de Reze". */
  readonly title: string
  /** The title it deletes whole; undefined when it isn't known, or only part of it goes. */
  readonly key: TitleKey | undefined
  /** Epoch milliseconds. */
  readonly at: number
  /** What Reclaimerr says it weighs. */
  readonly sizeBytes: number | undefined
}

/** A finished torrent, and when the download cleaner takes it (none: it stays). */
export interface TorrentInput {
  readonly hash: string
  readonly name: string
  readonly size: number
  readonly category: string | undefined
  readonly cleanup: {
    /** Epoch milliseconds; undefined when only a ratio takes it. */
    readonly at: number | undefined
    readonly timing: CleanupTiming
    /** Its files go with it (Delete, with the source files). */
    readonly freesFiles: boolean
  } | undefined
}

export interface SpaceBackInput {
  readonly deletions: ReadonlyArray<DeletionInput>
  /** Every finished torrent; undefined when qBittorrent couldn't be read (nothing can be sure then). */
  readonly torrents: ReadonlyArray<TorrentInput> | undefined
  /** The title each download was grabbed for, by lowercase hash. */
  readonly grabs: ReadonlyMap<string, TitleKey>
  /** Whether the title's files may still be in the library (true when Quai can't tell). */
  readonly inLibrary: (key: TitleKey) => boolean
  /** Whether Radarr's (movie) and Sonarr's (series) imports are hardlinks; undefined when unknown. */
  readonly hardlinks: { readonly movie: boolean | undefined; readonly series: boolean | undefined }
  /** Cleanuparr's category for torrents no hardlink holds: their files aren't in the library. */
  readonly unlinkedCategory: string | undefined
}

export interface SpaceBack {
  /** Bytes that come back when Reclaimerr deletes the candidate. */
  readonly deletions: ReadonlyMap<number, number>
  /** Bytes that come back when the download cleaner takes the torrent, by lowercase hash. */
  readonly torrents: ReadonlyMap<string, number>
}

const kindOf = (key: TitleKey): "movie" | "series" => key.startsWith("movie:") ? "movie" : "series"

/** The whole title a key belongs to: `series:5:s2` → `series:5`. */
const titleOf = (key: TitleKey) => key.split(":").slice(0, 2).join(":")

/** Whether deleting `deleted` takes the files of `files`: the same title, or a season of the series deleted. */
export const covers = (deleted: TitleKey, files: TitleKey) => deleted === files || (deleted === titleOf(deleted) && titleOf(files) === deleted)

/** Whether two titles may share files: one covers the other. */
const overlap = (a: TitleKey, b: TitleKey) => covers(a, b) || covers(b, a)

/** Torrents with the same name and size hold the same files: a cross-seed of the other. */
const sameFiles = (a: TorrentInput, b: TorrentInput) => a.size === b.size && a.name.toLowerCase() === b.name.toLowerCase()

/** Torrents holding the same files, and the title they are in the library. */
export interface FileSet {
  readonly torrents: ReadonlyArray<TorrentInput>
  /** The title they are in the library as; `null` when known not to be; undefined when Quai can't place them. */
  readonly key: TitleKey | null | undefined
}

/** The torrents grouped by the files they share, each set with the title it is in the library. */
export const fileSets = (input: Pick<SpaceBackInput, "grabs" | "unlinkedCategory">, torrents: ReadonlyArray<TorrentInput>): ReadonlyArray<FileSet> => {
  const sets: Array<Array<TorrentInput>> = []
  for (const torrent of torrents) {
    const set = sets.find((s) => s.some((t) => sameFiles(t, torrent)))
    if (set === undefined) sets.push([torrent])
    else set.push(torrent)
  }
  return sets.map((members): FileSet => {
    const keys = new Set(members.flatMap((t) => {
      const key = input.grabs.get(t.hash.toLowerCase())
      return key === undefined ? [] : [key]
    }))
    if (keys.size > 1) return { torrents: members, key: undefined }
    if (keys.size === 1) return { torrents: members, key: [...keys][0]! }
    const unlinked = input.unlinkedCategory !== undefined && members.some((t) => t.category === input.unlinkedCategory)
    return { torrents: members, key: unlinked ? null : undefined }
  })
}

/** One copy of the files going: the earliest and latest it can, and the row that says so. */
interface Going {
  readonly row: { readonly deletion: number } | { readonly torrent: string }
  readonly earliest: number
  readonly latest: number
}

/** When a torrent's files go: never (Infinity) when they stay, or when Quai can't bound it. */
export const torrentGoing = (torrent: TorrentInput): Going => {
  const cleanup = torrent.cleanup
  const row = { torrent: torrent.hash.toLowerCase() }
  if (cleanup === undefined || !cleanup.freesFiles || cleanup.at === undefined || cleanup.timing === "from") {
    return { row, earliest: Infinity, latest: Infinity }
  }
  return { row, earliest: cleanup.timing === "at" ? cleanup.at : -Infinity, latest: cleanup.at }
}

/**
 * The copy that surely goes last, if one does: every copy goes at a bounded time, and its earliest
 * is no sooner than every other's latest. A single copy is always its own last.
 */
export const surelyLast = (copies: ReadonlyArray<Going>): Going | undefined => {
  if (copies.length === 0 || copies.some((c) => !Number.isFinite(c.latest))) return undefined
  const last = copies.reduce((a, b) => b.latest > a.latest ? b : a)
  if (copies.length === 1) return last
  return copies.every((c) => c === last || c.latest <= last.earliest) ? last : undefined
}

/** Shares within which two sizes are the same files: a release and the library file it became. */
const sameSizeShare = 0.05

/** The words of a title or a release name, lowercase, without accents, years or one-letter words. */
const wordsOf = (text: string) =>
  new Set(text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^(19|20)\d\d$/.test(w)))

/**
 * Whether torrents Quai couldn't place may hold a deletion's files: about the same size, or every
 * word of its title in their name. Reclaimerr's title may be translated: the size still tells.
 */
export const mayHold = (set: FileSet, deletion: DeletionInput): boolean => {
  const size = deletion.sizeBytes ?? 0
  if (set.torrents.some((t) => size > 0 && Math.abs(t.size - size) <= size * sameSizeShare)) return true
  const title = wordsOf(deletion.title)
  return title.size > 0 && set.torrents.some((t) => {
    const name = wordsOf(t.name)
    return [...title].every((w) => name.has(w))
  })
}

const add = <K>(map: Map<K, number>, key: K, bytes: number) => map.set(key, (map.get(key) ?? 0) + bytes)

/**
 * The space each planned deletion and seed cleanup gives back, only when sure: on the row of the
 * copy that surely goes last, the size of the files. Copies (no hardlinks) are each their own space.
 * A torrent Quai can't place that may hold a title's files (`mayHold`) keeps its hardlinked
 * deletion from freeing anything by itself.
 */
export const spaceBack = (input: SpaceBackInput): SpaceBack => {
  const deletions = new Map<number, number>()
  const torrents = new Map<string, number>()
  if (input.torrents === undefined) return { deletions, torrents }
  const sets = fileSets(input, input.torrents)
  const deletionOf = (key: TitleKey) => input.deletions.filter((d) => d.key !== undefined && covers(d.key, key)).sort((a, b) => a.at - b.at)[0]

  for (const set of sets) {
    if (set.key === undefined) continue
    const hardlinked = set.key === null ? false : input.hardlinks[kindOf(set.key)]
    if (hardlinked === undefined) continue
    const copies: Array<Going> = set.torrents.map(torrentGoing)
    if (hardlinked && set.key !== null) {
      const deletion = deletionOf(set.key)
      if (deletion !== undefined) copies.push({ row: { deletion: deletion.candidateId }, earliest: deletion.at, latest: deletion.at })
      else if (input.inLibrary(set.key)) continue
    }
    const last = surelyLast(copies)
    if (last === undefined) continue
    const size = Math.max(...set.torrents.map((t) => t.size))
    if ("deletion" in last.row) add(deletions, last.row.deletion, size)
    else add(torrents, last.row.torrent, size)
  }

  const unplaced = sets.filter((s) => s.key === undefined)
  for (const deletion of input.deletions) {
    if (deletion.key === undefined || deletion.sizeBytes === undefined || deletions.has(deletion.candidateId)) continue
    const key = deletion.key
    const copy = input.hardlinks[kindOf(key)] === false
    const held = sets.some((s) => typeof s.key === "string" && overlap(key, s.key))
    const mightBeHeld = unplaced.some((s) => mayHold(s, deletion))
    // A copy goes by itself; hardlinked files only when no torrent holds them, or might.
    if (copy || (!held && !mightBeHeld)) deletions.set(deletion.candidateId, deletion.sizeBytes)
  }
  return { deletions, torrents }
}
