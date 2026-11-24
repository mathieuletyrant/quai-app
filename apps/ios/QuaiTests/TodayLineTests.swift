import Foundation
import Testing
@testable import Quai

struct TodayLineTests {
    private func releases(_ json: String) throws -> [DayRelease] {
        try JSONDecoder().decode([DayRelease].self, from: Data(json.utf8))
    }

    @Test func foldsASeriesEpisodesIntoOneLine() throws {
        let items = try releases(#"""
        [{"id":"episode:1","kind":"episode","libraryId":"series:8","title":"12 12 12","episode":"S01E03","airsAt":1795150800,"status":"available"},
         {"id":"episode:2","kind":"episode","libraryId":"series:31","title":"Percy Jackson and the Olympians","episode":"S02E04","airsAt":1795194000,"status":"available"},
         {"id":"episode:3","kind":"episode","libraryId":"series:31","title":"Percy Jackson and the Olympians","episode":"S02E05","airsAt":1795196400,"status":"missing"}]
        """#)
        let lines = TodayLine.lines(items)
        #expect(lines.map(\.title) == ["12 12 12", "Percy Jackson and the Olympians"])
        #expect(lines.map(\.episodes) == ["S01E03", "S02E04–E05"])
        #expect(lines[1].id == "episode:2")
        #expect(lines[1].releaseCount == 2)
        #expect(lines[1].status == .missing)
    }

    @Test func keepsMoviesApart() throws {
        let items = try releases(#"""
        [{"id":"movie:1","kind":"movie","libraryId":"movie:1","title":"Dune","status":"grabbed"},
         {"id":"movie:2","kind":"movie","libraryId":"movie:2","title":"Dune","status":"available"}]
        """#)
        let lines = TodayLine.lines(items)
        #expect(lines.count == 2)
        #expect(lines[0].episodes == nil)
    }

    @Test func carriesThePosterAndTheDetail() throws {
        let items = try releases(#"""
        [{"id":"episode:1","kind":"episode","libraryId":"series:7","title":"Tracker","episode":"S04E07","airsAt":1795150800,"status":"missing"},
         {"id":"episode:2","kind":"episode","libraryId":"series:7","title":"Tracker","episode":"S04E08","airsAt":1795150800,"posterUrl":"https://image.tmdb.org/t/p/original/tracker.jpg","status":"missing"},
         {"id":"movie:1","kind":"movie","libraryId":"movie:1","title":"Noël à la page","status":"available"}]
        """#)
        let lines = TodayLine.lines(items)
        #expect(lines[0].posterUrl == "https://image.tmdb.org/t/p/original/tracker.jpg")
        #expect(lines[0].isMovie == false)
        #expect(lines[0].detail == "S04E07–E08 · \(lines[0].airTime)")
        #expect(lines[1].posterUrl == nil)
        #expect(lines[1].isMovie)
        #expect(lines[1].detail == "Movie")
    }

    @Test func writesTheEpisodeCodes() {
        #expect(TodayLine.episodeCodes([]) == nil)
        #expect(TodayLine.episodeCodes(["S02E04"]) == "S02E04")
        #expect(TodayLine.episodeCodes(["S02E05", "S02E04", "S02E06"]) == "S02E04–E06")
        #expect(TodayLine.episodeCodes(["S02E04", "S02E07"]) == "S02E04, E07")
        #expect(TodayLine.episodeCodes(["S01E10", "S02E01"]) == "S01E10, S02E01")
    }
}
