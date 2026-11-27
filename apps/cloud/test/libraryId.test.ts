import { describe, expect, it } from "@effect/vitest"
import * as LibraryId from "@quai/domain/library/LibraryId.ts"

describe("library ids", () => {
  it("are made and read back the same", () => {
    expect(LibraryId.movie(55)).toBe("movie:55")
    expect(LibraryId.series(12)).toBe("series:12")
    expect(LibraryId.season(12, 3)).toBe("series:12:s3")
    expect(LibraryId.parse("movie:55")).toEqual({ kind: "movie", id: 55 })
    expect(LibraryId.parse("series:12:s3")).toEqual({ kind: "series", id: 12, season: 3 })
  })

  it("nothing else is one", () => {
    expect(LibraryId.parse("movie:55:s1")).toBeUndefined()
    expect(LibraryId.parse("episode:4")).toBeUndefined()
    expect(LibraryId.parse("movie:tmdb:1")).toBeUndefined()
  })

  it("a season belongs to its series", () => {
    expect(LibraryId.titleOf("series:12:s3")).toBe("series:12")
    expect(LibraryId.titleOf("movie:55")).toBe("movie:55")
  })
})
