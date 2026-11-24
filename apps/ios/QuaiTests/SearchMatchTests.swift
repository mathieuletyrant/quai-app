import Foundation
import Testing
@testable import Quai

/// A search result opens its library page when Radarr or Sonarr has the same title.
struct SearchMatchTests {
    private func library(_ json: String) throws -> Components.Schemas.Library {
        try JSONDecoder().decode(Components.Schemas.Library.self, from: Data(json.utf8))
    }

    private func result(_ kind: Components.Schemas.RequestKind, _ tmdbId: Int) -> SearchResult {
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
        #expect(result(.movie, 1461490).match(in: home)?.id == "movie:228")
        #expect(result(.series, 1461490).match(in: home)?.id == "series:7")
        #expect(result(.movie, 1).match(in: home) == nil)
        #expect(result(.movie, 1461490).match(in: nil) == nil)
    }
}
