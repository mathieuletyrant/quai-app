import Testing
@testable import Quai

struct ServerMarkTests {
    @Test func aSearchShowsASpinnerWhateverTheStatus() {
        #expect(ServerMark.of(status: .unreachable, searching: true, error: "Offline") == .searching)
    }

    @Test func greenOnceItAnsweredRedOnceItFailedWithWhy() {
        #expect(ServerMark.of(status: .connected, searching: false, error: nil) == .connected)
        #expect(ServerMark.of(status: .unreachable, searching: false, error: "Can't reach the Quai server.") == .unreachable("Can't reach the Quai server."))
        #expect(ServerMark.of(status: .unreachable, searching: false, error: nil) == .unreachable("Not reachable"))
    }

    @Test func nothingBeforeTheFirstAnswer() {
        #expect(ServerMark.of(status: .connecting, searching: false, error: nil) == nil)
    }
}
