import Foundation
import Testing
@testable import Quai

struct QuaiErrorsTests {
    private func error(_ status: Int, _ json: String) -> ConnectionError {
        ConnectionError(status: status, body: Data(json.utf8))
    }

    @Test func readsQuaisRefusalsByTheirTag() {
        #expect(error(401, #"{"_tag":"Unauthorized"}"#) == .removed)
        #expect(error(404, #"{"_tag":"NotFound"}"#) == .gone)
        #expect(error(503, #"{"_tag":"HomeOffline","message":"No Quai Home is connected"}"#) == .homeOffline)
        #expect(error(403, #"{"_tag":"InvalidPairingCode","message":"Unknown code"}"#) == .invalidCode)
    }

    @Test func showsTheServicesWordsForARefusedFix() {
        #expect(error(400, #"{"_tag":"InvalidFix","message":"This movie already has a file"}"#) == .refused("This movie already has a file"))
        #expect(error(502, #"{"_tag":"FixFailed","message":"A delete or move operation is already pending"}"#) == .refused("A delete or move operation is already pending"))
        #expect(error(502, #"{"_tag":"RequestFailed","message":"Seerr didn't answer"}"#).localizedDescription == "Seerr didn't answer")
        #expect(error(400, #"{"_tag":"InvalidAction","message":"This activity doesn't offer that button now."}"#) == .refused("This activity doesn't offer that button now."))
    }

    @Test func fallsBackOnTheStatus() {
        #expect(error(503, "") == .homeOffline)
        #expect(error(500, "Internal Server Error") == .server(500))
        #expect(error(404, "") == .server(404))
        #expect(error(400, #"{"_tag":"InvalidFix","message":""}"#) == .server(400))
    }

    @Test func saysTheSameForEveryRoute() {
        #expect(ConnectionError.removed.localizedDescription == "This iPhone was removed from the console. Pair it again.")
        #expect(ConnectionError.gone.localizedDescription.hasPrefix("This is already sorted out."))
    }

    @Test func aCancelledCallIsNoFailure() {
        #expect(CancellationError().isCancellation)
        #expect(URLError(.cancelled).isCancellation)
        #expect(!URLError(.timedOut).isCancellation)
        #expect(!ConnectionError.unreachable.isCancellation)
    }

    @Test func aCancelledReadKeepsWhatTheScreenShowed() {
        #expect(CancellationError().message(replacing: nil) == nil)
        #expect(URLError(.cancelled).message(replacing: "Earlier failure") == "Earlier failure")
        #expect(ConnectionError.unreachable.message(replacing: nil) == ConnectionError.unreachable.quaiMessage)
    }

    /// The server out of reach is said once, by its status; a refusal is the screen's own.
    @Test func tellsTheServerOutOfReachFromARefusal() {
        #expect(ConnectionError.unreachable.isConnectionFailure)
        #expect(ConnectionError.blockedByProxy.isConnectionFailure)
        #expect(ConnectionError.homeOffline.isConnectionFailure)
        #expect(URLError(.timedOut).isConnectionFailure)
        #expect(URLError(.notConnectedToInternet).isConnectionFailure)
        #expect(!URLError(.cancelled).isConnectionFailure)
        #expect(!CancellationError().isConnectionFailure)
        #expect(!ConnectionError.server(500).isConnectionFailure)
        #expect(!ConnectionError.refused("Seerr didn't answer").isConnectionFailure)
        #expect(!ConnectionError.removed.isConnectionFailure)
    }
}

/// Each tab reads what it shows; a failed read is said by the server's status or by its screen.
@MainActor
struct TabReadTests {
    @Test func eachTabReadsWhatItShows() {
        #expect(AppTab.home.reads == [.fixes, .homeTiles, .requests, .upcoming, .library])
        #expect(AppTab.library.reads == [.library])
        #expect(AppTab.activity.reads == [.journal])
        #expect(AppTab.settings.reads.isEmpty)
        #expect(AppTab.search.reads.isEmpty)
    }

    @Test func theServerOutOfReachIsTheServersStatus() {
        let unreachable = URLError(.cannotConnectToHost)
        #expect(ReadFailure(unreachable, shown: "Before") == .server(unreachable.quaiMessage))
        #expect(ReadFailure(ConnectionError.homeOffline, shown: nil) == .server(ConnectionError.homeOffline.quaiMessage))
    }

    @Test func aReadsOwnFailureIsItsScreens() {
        #expect(ReadFailure(ConnectionError.server(500), shown: nil) == .screen("The server answered 500."))
        #expect(ReadFailure(ConnectionError.refused("Seerr didn't answer"), shown: "Before") == .screen("Seerr didn't answer"))
        // Cancelled: what the screen showed stays.
        #expect(ReadFailure(CancellationError(), shown: "Before") == .screen("Before"))
    }

    /// The server out of reach is an answer: no screen waits on it forever.
    @Test func aReadAwaitsUntilItAnswersOrTheServerIsOutOfReach() {
        #expect(Connection.awaits(hasValue: false, failure: nil, serverError: nil))
        #expect(!Connection.awaits(hasValue: true, failure: nil, serverError: nil))
        #expect(!Connection.awaits(hasValue: false, failure: "The server answered 500.", serverError: nil))
        #expect(!Connection.awaits(hasValue: false, failure: nil, serverError: "Can't reach the Quai server."))
    }
}
