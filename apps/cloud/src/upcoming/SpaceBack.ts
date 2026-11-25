/**
 * Space back (GLOSSARY): when a title's room on the disk really comes back. With hardlinks, the
 * library's copy and every torrent seeding the same files (cross-seeds too) are one set of files:
 * the space comes back when the last of them goes, and only then. Pure: the caller reads the
 * services, this decides. Whatever Quai can't be sure of gives no space at all: a row says "+X GB"
 * only when its own moment is surely the last copy going.
 */
import type { TitleKind } from "@quai/api"
import type { CleanupTiming } from "../integrations/cleanuparr.ts"
import * as LibraryId from "../library/LibraryId.ts"

/** A title as the library holds it (`LibraryId`): a movie, a series, a season. */
export type TitleKey = LibraryId.LibraryId

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

const kindOf = (key: TitleKey): TitleKind => LibraryId.parse(key)?.kind ?? "series"

const titleOf = LibraryId.titleOf

/** Whether deleting `deleted` takes the files of `files`: the same title, or a season of the series deleted. */
export const covers = (deleted: TitleKey, files: TitleKey) =>
  deleted === files || (deleted === titleOf(deleted) && titleOf(files) === deleted)

/** Torrents with the same name (any case) and size hold the same files: a cross-seed of the other. */
const filesOf = (torrent: TorrentInput) => `${torrent.size}:${torrent.name.toLowerCase()}`

/** Torrents holding the same files, and the title they are in the library. */
export interface FileSet {
  readonly torrents: ReadonlyArray<TorrentInput>
  /** The title they are in the library as; `null` when known not to be; undefined when Quai can't place them. */
  readonly key: TitleKey | null | undefined
}

/** The torrents grouped by the files they share, each set with the title it is in the library. */
export const fileSets = (
  input: Pick<SpaceBackInput, "grabs" | "unlinkedCategory">,
  torrents: ReadonlyArray<TorrentInput>
): ReadonlyArray<FileSet> => {
  const sets = new Map<string, Array<TorrentInput>>()
  for (const torrent of torrents) {
    const files = filesOf(torrent)
    const set = sets.get(files)
    if (set === undefined) sets.set(files, [torrent])
    else set.push(torrent)
  }
  return [...sets.values()].map((members): FileSet => {
    const keys = new Set(members.flatMap((member) => {
      const key = input.grabs.get(member.hash.toLowerCase())
      return key === undefined ? [] : [key]
    }))
    if (keys.size > 1) return { torrents: members, key: undefined }
    if (keys.size === 1) return { torrents: members, key: [...keys][0]! }
    const unlinked = input.unlinkedCategory !== undefined &&
      members.some((member) => member.category === input.unlinkedCategory)
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
  if (copies.length === 0 || copies.some((copy) => !Number.isFinite(copy.latest))) return undefined
  const last = copies.reduce((latest, copy) => copy.latest > latest.latest ? copy : latest)
  if (copies.length === 1) return last
  return copies.every((copy) => copy === last || copy.latest <= last.earliest) ? last : undefined
}

/** Shares within which two sizes are the same files: a release and the library file it became. */
const sameSizeShare = 0.05

/** The words of a title or a release name, lowercase, without accents. */
const tokensOf = (text: string) =>
  text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "")

/** A title's telling words: no years or one-letter words, unless that's all it has ("1917", "X"). */
const titleWords = (title: string) => {
  const tokens = tokensOf(title)
  const telling = tokens.filter((word) => word.length > 1 && !/^(19|20)\d\d$/.test(word))
  return new Set(telling.length > 0 ? telling : tokens)
}

/** The index of the first of the sorted `values` that is `atLeast` or more (their length when none is). */
const lowerBound = (values: ReadonlyArray<number>, atLeast: number) => {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (values[middle]! < atLeast) low = middle + 1
    else high = middle
  }
  return low
}

/** Whether one of the sorted sizes is about `size` (within `sameSizeShare`). */
const aboutTheSize = (sizes: ReadonlyArray<number>, size: number) => {
  const share = size * sameSizeShare
  // A byte of margin each side of the search, then the exact test.
  for (let index = lowerBound(sizes, Math.floor(size - share) - 1); index < sizes.length; index++) {
    const other = sizes[index]!
    if (other > size + share + 1) return false
    if (Math.abs(other - size) <= share) return true
  }
  return false
}

/** Whether one of the names (each a set of words) has every word of `title`: looked up from the rarest word. */
const namedAfter = (
  names: ReadonlyArray<ReadonlySet<string>>,
  withWord: ReadonlyMap<string, ReadonlyArray<number>>,
  title: ReadonlySet<string>
) => {
  const words = [...title]
  const postings = words.map((word) => withWord.get(word) ?? [])
  const rarest = postings.reduce((fewest, posting) => posting.length < fewest.length ? posting : fewest)
  return rarest.some((index) => words.every((word) => names[index]!.has(word)))
}

/**
 * Whether torrents Quai couldn't place may hold a deletion's files: one about the same size, or
 * with every word of its title in its name. Reclaimerr's title may be translated: the size still
 * tells. Their sizes and words are indexed once, on the first deletion asked about.
 */
export const mayHold = (unplaced: ReadonlyArray<FileSet>) => {
  let index:
    | {
      readonly sizes: ReadonlyArray<number>
      readonly names: ReadonlyArray<ReadonlySet<string>>
      readonly withWord: ReadonlyMap<string, ReadonlyArray<number>>
    }
    | undefined
  const indexed = () => {
    if (index !== undefined) return index
    const members = unplaced.flatMap((set) => set.torrents)
    const names = members.map((member) => new Set(tokensOf(member.name)))
    const withWord = new Map<string, Array<number>>()
    names.forEach((name, position) => {
      for (const word of name) {
        const posting = withWord.get(word)
        if (posting === undefined) withWord.set(word, [position])
        else posting.push(position)
      }
    })
    index = { sizes: members.map((member) => member.size).sort((left, right) => left - right), names, withWord }
    return index
  }
  return (deletion: DeletionInput): boolean => {
    if (unplaced.length === 0) return false
    const { names, sizes, withWord } = indexed()
    const size = deletion.sizeBytes ?? 0
    if (size > 0 && aboutTheSize(sizes, size)) return true
    const title = titleWords(deletion.title)
    return title.size > 0 && namedAfter(names, withWord, title)
  }
}

const add = <K>(map: Map<K, number>, key: K, bytes: number) => map.set(key, (map.get(key) ?? 0) + bytes)

/** The titles whose deletion takes the files of `key` (`covers`): itself, and the series of a season. */
const coveringKeys = (key: TitleKey) => {
  const title = titleOf(key)
  return title === key ? [key] : [key, title]
}

/**
 * The first deletion Reclaimerr plans that takes the files of a title: the soonest, the first
 * listed of those as soon. Indexed by the title each deletes once, then looked up.
 */
const firstDeletions = (deletions: ReadonlyArray<DeletionInput>) => {
  const first = new Map<TitleKey, { readonly deletion: DeletionInput; readonly index: number }>()
  deletions.forEach((deletion, index) => {
    if (deletion.key === undefined) return
    const known = first.get(deletion.key)
    if (known === undefined || deletion.at < known.deletion.at) first.set(deletion.key, { deletion, index })
  })
  return (key: TitleKey): DeletionInput | undefined =>
    coveringKeys(key)
      .flatMap((covering) => first.get(covering) ?? [])
      .sort((left, right) => left.deletion.at - right.deletion.at || left.index - right.index)[0]?.deletion
}

/** Whether a set placed in the library may share files with `key`, one covering the other: indexed once, then looked up. */
const placedOverlap = (sets: ReadonlyArray<FileSet>) => {
  const placed = new Set<TitleKey>()
  const titles = new Set<TitleKey>()
  for (const set of sets) {
    if (typeof set.key !== "string") continue
    placed.add(set.key)
    titles.add(titleOf(set.key))
  }
  // A set of the title or of its series covers it; a whole title covers the sets of its seasons.
  return (key: TitleKey) => placed.has(key) || placed.has(titleOf(key)) || (key === titleOf(key) && titles.has(key))
}

/**
 * Every copy of a set's files and when it goes: its torrents, and with hardlinks the library's copy
 * when a deletion takes it. Undefined when Quai can't be sure: the set can't be placed, the kind's
 * hardlinks are unknown, or the library keeps the files with no deletion planned.
 */
const copiesOf = (
  input: SpaceBackInput,
  set: FileSet,
  firstDeletionOf: (key: TitleKey) => DeletionInput | undefined
): ReadonlyArray<Going> | undefined => {
  if (set.key === undefined) return undefined
  const hardlinked = set.key === null ? false : input.hardlinks[kindOf(set.key)]
  if (hardlinked === undefined) return undefined
  const torrents = set.torrents.map(torrentGoing)
  if (!hardlinked || set.key === null) return torrents
  const deletion = firstDeletionOf(set.key)
  if (deletion !== undefined) {
    return [...torrents, { row: { deletion: deletion.candidateId }, earliest: deletion.at, latest: deletion.at }]
  }
  return input.inLibrary(set.key) ? undefined : torrents
}

/**
 * The space a deletion gives back by itself, when no set's last copy accounted for it: a copy goes
 * by itself; hardlinked files only when no torrent holds them, or might.
 */
const deletionAlone = (
  input: SpaceBackInput,
  deletion: DeletionInput,
  held: (key: TitleKey) => boolean,
  mightBeHeld: (deletion: DeletionInput) => boolean
): number | undefined => {
  const key = deletion.key
  if (key === undefined || deletion.sizeBytes === undefined) return undefined
  if (input.hardlinks[kindOf(key)] === false) return deletion.sizeBytes
  return held(key) || mightBeHeld(deletion) ? undefined : deletion.sizeBytes
}

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
  const firstDeletionOf = firstDeletions(input.deletions)

  for (const set of sets) {
    const copies = copiesOf(input, set, firstDeletionOf)
    const last = copies === undefined ? undefined : surelyLast(copies)
    if (last === undefined) continue
    const size = Math.max(...set.torrents.map((member) => member.size))
    if ("deletion" in last.row) add(deletions, last.row.deletion, size)
    else add(torrents, last.row.torrent, size)
  }

  const held = placedOverlap(sets)
  const mightBeHeld = mayHold(sets.filter((set) => set.key === undefined))
  for (const deletion of input.deletions) {
    if (deletions.has(deletion.candidateId)) continue
    const bytes = deletionAlone(input, deletion, held, mightBeHeld)
    if (bytes !== undefined) deletions.set(deletion.candidateId, bytes)
  }
  return { deletions, torrents }
}
