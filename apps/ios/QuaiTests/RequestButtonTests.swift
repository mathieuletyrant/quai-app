import Testing
@testable import Quai

/// The button a search result offers, by where the title stands in Seerr.
struct RequestButtonTests {
    @Test func aTitleNobodyAskedForIsRequested() {
        #expect(TitleState.requestable.requestButton(for: .movie) == .request)
        #expect(TitleState.requestable.requestButton(for: .series) == .request)
    }

    /// Season 1 asked for and still on its way: Seerr says the whole series is requested, and
    /// season 2 can still be asked for.
    @Test func aSeriesAskedForCanGetMoreSeasons() {
        #expect(TitleState.requested.requestButton(for: .series) == .moreSeasons)
    }

    @Test func aSeriesPartlyInTheLibraryCanGetMoreSeasons() {
        #expect(TitleState.partial.requestButton(for: .series) == .moreSeasons)
    }

    @Test func aMovieAskedForHasNoButton() {
        #expect(TitleState.requested.requestButton(for: .movie) == nil)
    }

    @Test func aTitleInTheLibraryHasNoButton() {
        #expect(TitleState.available.requestButton(for: .movie) == nil)
        #expect(TitleState.available.requestButton(for: .series) == nil)
    }
}
