/**
 * Space back (GLOSSARY): when a title's room on the disk really comes back. With hardlinks, the
 * library's copy and every torrent seeding the same files (cross-seeds too) are one set of files:
 * the space comes back when the last of them goes, and only then. Pure: the caller reads the
 * services, this decides. Whatever Quai can't be sure of gives no space at all.
 */

/** A title as the library holds it: `movie:<radarr id>`, `series:<sonarr id>`, a season `series:<id>:s<n>`. */
export type TitleKey = string

/** A deletion Reclaimerr plans, as space back needs it. */
export interface DeletionInput {
  readonly candidateId: number
  /** The title it deletes; undefined when it isn't found in Radarr or Sonarr, or only part of it goes (an episode, a move). */
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
  readonly cleanup: { readonly at: number | undefined; readonly freesFiles: boolean } | undefined
}

export interface SpaceBackInput {
  readonly deletions: ReadonlyArray<DeletionInput>
  /** Every finished torrent; undefined when qBittorrent couldn't be read (nothing can be sure then). */
  readonly torrents: ReadonlyArray<TorrentInput> | undefined
  /** The title each download was grabbed for, by lowercase hash. */
  readonly grabs: ReadonlyMap<string, TitleKey>
  /** Whether the title is still in the library (a movie with its file, a series with files). */
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
const covers = (deleted: TitleKey, files: TitleKey) => deleted === files || (deleted === titleOf(deleted) && titleOf(files) === deleted)

/** Torrents with the same name and size hold the same files: a cross-seed of the other. */
const sameFiles = (a: TorrentInput, b: TorrentInput) => a.size === b.size && a.name.toLowerCase() === b.name.toLowerCase()

interface FileSet {
  readonly torrents: ReadonlyArray<TorrentInput>
  /** The title the files are in the library as; undefined when no grab says, `null` when they're known not to be. */
  readonly key: TitleKey | null | undefined
}

/** The torrents grouped by the files they share, each with the title they are in the library. */
const fileSets = (input: SpaceBackInput, torrents: ReadonlyArray<TorrentInput>): ReadonlyArray<FileSet> => {
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

/**
 * The space each planned deletion and seed cleanup gives back, only when sure: the moment the last
 * copy of the files goes, the size of the files. Copies (no hardlinks) are each their own space.
 */
export const spaceBack = (input: SpaceBackInput): SpaceBack => {
  const deletions = new Map<number, number>()
  const torrents = new Map<string, number>()
  if (input.torrents === undefined) return { deletions, torrents }
  const sets = fileSets(input, input.torrents)
  const deletionOf = (key: TitleKey) => input.deletions.filter((d) => d.key !== undefined && covers(d.key, key)).sort((a, b) => a.at - b.at)[0]
  const goneAt = (torrent: TorrentInput) =>
    torrent.cleanup?.freesFiles === true && torrent.cleanup.at !== undefined ? torrent.cleanup.at : Infinity

  for (const set of sets) {
    if (set.key === undefined) continue
    const hardlinked = set.key === null ? false : input.hardlinks[kindOf(set.key)]
    if (hardlinked === undefined) continue
    const last = set.torrents.reduce((a, b) => goneAt(b) > goneAt(a) ? b : a)
    const torrentsGone = goneAt(last)
    const size = Math.max(...set.torrents.map((t) => t.size))
    const deletion = set.key === null ? undefined : deletionOf(set.key)
    const libraryGone = !hardlinked || set.key === null
      ? -Infinity
      : deletion !== undefined
      ? deletion.at
      : input.inLibrary(set.key)
      ? Infinity
      : -Infinity
    const at = Math.max(torrentsGone, libraryGone)
    if (!Number.isFinite(at)) continue
    if (deletion !== undefined && hardlinked && deletion.at >= torrentsGone) {
      deletions.set(deletion.candidateId, (deletions.get(deletion.candidateId) ?? 0) + size)
    } else {
      torrents.set(last.hash.toLowerCase(), (torrents.get(last.hash.toLowerCase()) ?? 0) + size)
    }
  }

  for (const deletion of input.deletions) {
    if (deletion.key === undefined || deletion.sizeBytes === undefined || deletions.has(deletion.candidateId)) continue
    const key = deletion.key
    const held = sets.some((s) => typeof s.key === "string" && (covers(key, s.key) || covers(s.key, key)))
    // A copy goes by itself; hardlinked files go when no torrent holds them.
    if (input.hardlinks[kindOf(key)] === false || !held) deletions.set(deletion.candidateId, deletion.sizeBytes)
  }
  return { deletions, torrents }
}
