import { type DiskHolds, type DiskSpace, HomeProtocol, type LibraryService } from "@quai/api"
import { Effect, Option, Schema } from "effect"
import type { LinkedHome } from "../home/HomeLink.ts"
import type { HomeReads, Read } from "../home/HomeReads.ts"

/** `GET /api/v3/diskspace`: every mount the service sees, the same disk often several times. */
export const DiskSpaces = Schema.Array(Schema.Struct({
  path: Schema.String,
  freeSpace: Schema.Number,
  totalSpace: Schema.Number
}))
export type DiskSpaces = typeof DiskSpaces.Type

/** `GET /api/v3/rootfolder`: where the service keeps its titles. */
export const RootFolders = Schema.Array(Schema.Struct({ path: Schema.String }))
export type RootFolders = typeof RootFolders.Type

const arrServices = ["radarr", "sonarr"] as const satisfies ReadonlyArray<LibraryService>

const readsOf = (service: LibraryService) => ({
  mounts: { service, path: "/api/v3/diskspace", schema: DiskSpaces } satisfies Read<DiskSpaces>,
  roots: { service, path: "/api/v3/rootfolder", schema: RootFolders } satisfies Read<RootFolders>
})

/** Radarr's and Sonarr's disk lists and root folders, each read once. */
export const diskReads = { radarr: readsOf("radarr"), sonarr: readsOf("sonarr") } as const

/**
 * What one service sees of the disks: its mounts, and its root folders when Quai Home allows them
 * (`storageProtocolVersion`) and the service answered.
 */
export interface DiskView {
  readonly service: LibraryService
  readonly mounts: DiskSpaces
  readonly roots?: RootFolders
}

/** A disk that holds a Radarr or Sonarr root folder (GLOSSARY: media disk). */
export interface MediaDisk extends DiskSpace {
  /** Stable while the disk is the same: from its size, which no service names differently. */
  readonly id: string
  readonly name: string
  readonly holds: ReadonlyArray<DiskHolds>
}

const holdsOf: Record<LibraryService, DiskHolds> = { radarr: "movies", sonarr: "shows" }

const holdsNames: Record<DiskHolds, string> = { movies: "Movies", shows: "Shows" }

/** Below this, two readings of the same size are the same disk read a moment apart. */
const sameDiskFreeBytes = 1e9

type Mount = DiskSpaces[number]

/** The mount a root folder lives on: the longest mount path it starts with. */
export const mountOf = (root: string, mounts: DiskSpaces): Mount | undefined => {
  const inside = (mount: Mount) =>
    mount.path === "/" || root === mount.path ||
    root.startsWith(mount.path.endsWith("/") ? mount.path : `${mount.path}/`)
  return mounts.filter(inside).sort((left, right) => right.path.length - left.path.length)[0]
}

/** The mounts that hold the media: those of the root folders, else (no root folders) the largest. */
const mediaMounts = (view: DiskView): ReadonlyArray<Mount> => {
  if (view.roots === undefined) {
    const largest = [...view.mounts].sort((left, right) => right.totalSpace - left.totalSpace)[0]
    return largest === undefined || largest.totalSpace <= 0 ? [] : [largest]
  }
  return view.roots.flatMap((root) => {
    const mount = mountOf(root.path, view.mounts)
    return mount === undefined || mount.totalSpace <= 0 ? [] : [mount]
  })
}

interface Found extends DiskSpace {
  readonly mount: string
  readonly holds: Set<DiskHolds>
  readonly services: Set<LibraryService>
}

/**
 * The disk a service's mount is, among those found: one service reads all its mounts at once, so
 * its own mounts of the same size are one disk only when their free space matches (within 1 GB);
 * another service's view may be older (Quai Home sends a reading when it changes), so a disk of
 * the same size it saw is this one, the nearest in free space when there are twins.
 */
export const diskOf = (found: ReadonlyArray<Found>, service: LibraryService, disk: DiskSpace): Found | undefined => {
  const sized = found.filter((candidate) => candidate.totalBytes === disk.totalBytes)
  const own = sized.filter((candidate) => candidate.services.has(service))
  const same = own.find((candidate) => Math.abs(candidate.freeBytes - disk.freeBytes) < sameDiskFreeBytes)
  if (same !== undefined) return same
  const gap = (candidate: Found) => Math.abs(candidate.freeBytes - disk.freeBytes)
  return sized.filter((candidate) => !candidate.services.has(service)).sort((left, right) => gap(left) - gap(right))[0]
}

/** The share free, 0 to 1. */
export const freeShare = (disk: DiskSpace) => disk.freeBytes / disk.totalBytes

const slug = (path: string) => path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root"

/**
 * The media disks the services see, fullest first. Radarr's `/downloads` and Sonarr's `/data` are
 * the same disk when they are the same size (`diskOf`); a service's two mounts of the same size
 * and free space are one disk seen twice.
 */
export const mediaDisks = (views: ReadonlyArray<DiskView>): ReadonlyArray<MediaDisk> => {
  const found: Array<Found> = []
  for (const view of views) {
    for (const mount of mediaMounts(view)) {
      const disk = { freeBytes: mount.freeSpace, totalBytes: mount.totalSpace }
      const known = diskOf(found, view.service, disk)
      if (known === undefined) {
        found.push({
          ...disk,
          mount: mount.path,
          holds: new Set([holdsOf[view.service]]),
          services: new Set([view.service])
        })
      } else {
        known.holds.add(holdsOf[view.service])
        known.services.add(view.service)
      }
    }
  }
  const sizes = new Map<number, number>()
  for (const disk of found) sizes.set(disk.totalBytes, (sizes.get(disk.totalBytes) ?? 0) + 1)
  return found.map((disk): MediaDisk => {
    const holds = (["movies", "shows"] as const).filter((kind) => disk.holds.has(kind))
    // Two disks of the same size: their mount tells them apart.
    const twin = (sizes.get(disk.totalBytes) ?? 0) > 1
    return {
      id: `d${disk.totalBytes}${twin ? `-${slug(disk.mount)}` : ""}`,
      name: holds.map((kind) => holdsNames[kind]).join(" · "),
      holds,
      freeBytes: disk.freeBytes,
      totalBytes: disk.totalBytes
    }
  }).sort((left, right) => freeShare(left) - freeShare(right))
}

/** Quai Home allows the root folders. */
export const readsRoots = (home: Pick<LinkedHome, "protocol">) => home.protocol >= HomeProtocol.storageProtocolVersion

/**
 * The media disks now, read through Quai Home: each service's disks and root folders. A service
 * that didn't answer is listed as unavailable and left out; the others still count.
 */
export const readMediaDisks = (reads: HomeReads["Service"], home: Pick<LinkedHome, "services" | "protocol">) =>
  Effect.gen(function*() {
    const reached = arrServices.filter((service) => home.services.includes(service))
    const views = yield* Effect.forEach(reached, (service) =>
      Effect.all({
        mounts: reads.read(diskReads[service].mounts),
        roots: readsRoots(home) ? reads.read(diskReads[service].roots) : Effect.succeed(Option.none())
      }).pipe(Effect.map(({ mounts, roots }) =>
        Option.map(mounts, (list): DiskView => ({
          service,
          mounts: list,
          ...(Option.isSome(roots) ? { roots: roots.value } : {})
        }))
      )), { concurrency: "unbounded" })
    const read = views.flatMap((view) => Option.isSome(view) ? [view.value] : [])
    return {
      disks: mediaDisks(read),
      unavailable: reached.filter((_, index) => Option.isNone(views[index]!))
    }
  })
