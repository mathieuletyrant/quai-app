import Foundation
import Testing
@testable import Quai

/// A search result opens its library page when Radarr or Sonarr has the same title.
struct SearchMatchTests {
    private func library(_ json: String) throws -> Components.Schemas.Library {
        try JSONDecoder().decode(Components.Schemas.Library.self, from: Data(json.utf8))
    }

    private func result(_ kind: Components.Schemas.TitleKind, _ tmdbId: Int) -> SearchResult {
        SearchResult(kind: kind, tmdbId: tmdbId, title: "Title", year: nil, posterUrl: nil, overview: nil, state: .requested)
    }

    @Test func findsTheTitleByKindAndTmdbId() throws {
        let home = try library(#"""
        {"items":[
          {"id":"movie:228","kind":"movie","title":"Hershey","tmdbId":1461490,"status":"wanted","sizeBytes":0},
          {"id":"series:7","kind":"series","title":"Same id","tmdbId":1461490,"status":"available","sizeBytes":1},
          {"id":"movie:9","kind":"movie","title":"No id","status":"available","sizeBytes":1}
        ],"unavailable":[]}
        """#)
        #expect(result(.movie, 1_461_490).match(in: home)?.id == "movie:228")
        #expect(result(.series, 1_461_490).match(in: home)?.id == "series:7")
        #expect(result(.movie, 1).match(in: home) == nil)
        #expect(result(.movie, 1_461_490).match(in: nil) == nil)
    }

    /// Recorded from a real Sonarr and Seerr: Sonarr gives "Our House" a TMDB id of 0, Seerr's
    /// result carries its TVDB id. The series is found by it.
    @Test func findsASeriesSonarrKnowsOnlyByTvdbId() throws {
        let home = try library(#"""
        {"items":[{"id":"series:233","kind":"series","title":"Our House (2022)","tvdbId":407046,"status":"available","sizeBytes":3069933130}],"unavailable":[]}
        """#)
        let notreMaison = SearchResult(kind: .series, tmdbId: 157_014, tvdbId: 407_046, title: "Notre maison", year: 2022, posterUrl: nil, overview: nil, state: .available)
        #expect(notreMaison.match(in: home)?.id == "series:233")
        let namesake = SearchResult(kind: .series, tmdbId: 10_625, title: "Our House", year: 1986, posterUrl: nil, overview: nil, state: .requestable)
        #expect(namesake.match(in: home) == nil)
    }

    /// A series of the library opens the season picker under its TMDB id; a movie, or a series
    /// Sonarr knows only by its TVDB id (TMDB id 0 or none), can't be requested from there.
    @Test func aLibrarySeriesIsRequestedByItsTmdbId() throws {
        let home = try library(#"""
        {"items":[
          {"id":"series:12","kind":"series","title":"This Is Us","year":2016,"tmdbId":67136,"tvdbId":311714,"status":"available","sizeBytes":1},
          {"id":"series:233","kind":"series","title":"Our House (2022)","tmdbId":0,"tvdbId":407046,"status":"available","sizeBytes":1},
          {"id":"series:9","kind":"series","title":"No id","status":"available","sizeBytes":1},
          {"id":"movie:228","kind":"movie","title":"Hershey","tmdbId":1461490,"status":"wanted","sizeBytes":0}
        ],"unavailable":[]}
        """#)
        let series = try #require(home.items[0].seerrSeries)
        #expect(series.kind == .series)
        #expect(series.tmdbId == 67_136)
        #expect(series.title == "This Is Us")
        #expect(series.state.requestButton(for: .series) == .moreSeasons)
        #expect(home.items[1].seerrSeries == nil)
        #expect(home.items[2].seerrSeries == nil)
        #expect(home.items[3].seerrSeries == nil)
    }
}
