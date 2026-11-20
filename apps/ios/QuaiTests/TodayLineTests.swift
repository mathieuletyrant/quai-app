import Foundation
import Testing
@testable import Quai

struct TodayLineTests {
    private func releases(_ json: String) throws -> [DayRelease] {
        try JSONDecoder().decode([DayRelease].self, from: Data(json.utf8))
    }

    @Test func foldsASeriesEpisodesIntoOneLine() throws {
        let items = try releases(#"""
        [{"id":"episode:1","kind":"episode","title":"12 12 12","episode":"S01E03","airsAt":1795150800,"status":"available"},
         {"id":"episode:2","kind":"episode","title":"Percy Jackson and the Olympians","episode":"S02E04","airsAt":1795194000,"status":"available"},
         {"id":"episode:3","kind":"episode","title":"Percy Jackson and the Olympians","episode":"S02E05","airsAt":1795196400,"status":"missing"}]
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
        [{"id":"movie:1","kind":"movie","title":"Dune","status":"grabbed"},
         {"id":"movie:2","kind":"movie","title":"Dune","status":"available"}]
        """#)
        let lines = TodayLine.lines(items)
        #expect(lines.count == 2)
        #expect(lines[0].episodes == nil)
    }

    @Test func writesTheEpisodeCodes() {
        #expect(TodayLine.episodeCodes([]) == nil)
        #expect(TodayLine.episodeCodes(["S02E04"]) == "S02E04")
        #expect(TodayLine.episodeCodes(["S02E05", "S02E04", "S02E06"]) == "S02E04–E06")
        #expect(TodayLine.episodeCodes(["S02E04", "S02E07"]) == "S02E04, E07")
        #expect(TodayLine.episodeCodes(["S01E10", "S02E01"]) == "S01E10, S02E01")
    }
}
