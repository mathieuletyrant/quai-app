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
}
