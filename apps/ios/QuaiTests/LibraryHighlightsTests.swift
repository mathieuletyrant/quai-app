import Foundation
import Testing
@testable import Quai

struct LibraryHighlightsTests {
    private func items(_ json: String) throws -> [LibraryItem] {
        try JSONDecoder().decode([LibraryItem].self, from: Data(json.utf8))
    }

    /// 2026-11-24 12:00 UTC.
    private let now = Date(timeIntervalSince1970: 1_795_521_600)

    @Test func keepsTheThreeLatestAndCountsTheWeek() throws {
        let library = try items(#"""
        [{"id":"movie:1","kind":"movie","title":"Old","status":"available","addedAt":1790000000,"sizeBytes":1},
         {"id":"movie:2","kind":"movie","title":"Dune","status":"wanted","addedAt":1795500000,"sizeBytes":0},
         {"id":"series:3","kind":"series","title":"Severance","status":"available","addedAt":1795400000,"sizeBytes":1},
         {"id":"movie:4","kind":"movie","title":"Nero","status":"notAvailable","addedAt":1795000000,"sizeBytes":0},
         {"id":"movie:5","kind":"movie","title":"No date","status":"wanted","sizeBytes":0}]
        """#)
        let highlights = LibraryHighlights(library, now: now)
        #expect(highlights.latest.map(\.id) == ["movie:2", "series:3", "movie:4"])
        #expect(highlights.addedThisWeek == 3)
        #expect(highlights.recentCaption == "3 this week")
        #expect(highlights.wanted == 2)
    }

    @Test func saysWhatTheLatestIsWhenNothingCameThisWeek() throws {
        let library = try items(#"""
        [{"id":"movie:1","kind":"movie","title":"Old","year":2020,"status":"available","addedAt":1790000000,"sizeBytes":1}]
        """#)
        let highlights = LibraryHighlights(library, now: now)
        #expect(highlights.addedThisWeek == 0)
        #expect(highlights.recentCaption == "Movie · 2020")
        #expect(highlights.wanted == 0)
    }

    @Test func writesTheWantedCaption() {
        #expect(LibraryHighlights.wantedCaption(0) == "Nothing missing")
        #expect(LibraryHighlights.wantedCaption(1) == "title missing")
        #expect(LibraryHighlights.wantedCaption(7) == "titles missing")
    }

    @Test func anEmptyLibraryHasNoTiles() {
        #expect(LibraryHighlights([], now: now).isEmpty)
    }
}
