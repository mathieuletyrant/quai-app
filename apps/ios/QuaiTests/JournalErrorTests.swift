import Testing
@testable import Quai

/// The Activity tab says a failure once: the history's card only when it failed on its own.
struct JournalErrorTests {
    private let unreachable = ConnectionError.unreachable.localizedDescription

    @Test func theSameFailureAsTheActivitiesShowsOnce() {
        #expect(JournalSection.ownError(unreachable, above: unreachable) == nil)
    }

    @Test func aFailureOfItsOwnStillShows() {
        let server = ConnectionError.server(500).localizedDescription
        #expect(JournalSection.ownError(server, above: unreachable) == server)
        #expect(JournalSection.ownError(server, above: nil) == server)
    }

    @Test func nothingFailedNothingShows() {
        #expect(JournalSection.ownError(nil, above: unreachable) == nil)
        #expect(JournalSection.ownError(nil, above: nil) == nil)
    }
}
