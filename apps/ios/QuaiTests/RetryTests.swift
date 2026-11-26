import Foundation
import Testing
@testable import Quai

/// A read tries again while the server is out of reach, and only then.
@MainActor
struct RetryTests {
    private let delays: [Duration] = [.zero, .zero]

    /// Fails with these errors in turn, then answers 42; counts its attempts.
    private final class Attempts {
        var failures: [any Error]
        var count = 0

        init(_ failures: [any Error]) { self.failures = failures }

        func next() throws -> Int {
            count += 1
            if failures.isEmpty { return 42 }
            throw failures.removeFirst()
        }
    }

    @Test func aBlinkOfTheNetworkIsTriedAgain() async throws {
        let attempts = Attempts([URLError(.cannotConnectToHost), ConnectionError.unreachable])
        var retried = 0
        let value = try await Connection.retrying(after: delays) {
            try attempts.next()
        } beforeRetry: {
            retried += 1
        }
        #expect(value == 42)
        #expect(attempts.count == 3)
        #expect(retried == 2)
    }

    @Test func theServerStillOutOfReachIsSaid() async {
        let attempts = Attempts([URLError(.timedOut), URLError(.timedOut), URLError(.timedOut)])
        await #expect(throws: URLError.self) {
            try await Connection.retrying(after: delays) { try attempts.next() }
        }
        #expect(attempts.count == 3)
    }

    @Test func anAnswerIsNeverAskedAgain() async {
        let attempts = Attempts([ConnectionError.server(500)])
        await #expect(throws: ConnectionError.server(500)) {
            try await Connection.retrying(after: delays) { try attempts.next() }
        }
        #expect(attempts.count == 1)
    }

    @Test func aCancelledReadIsNotTriedAgain() async {
        let attempts = Attempts([CancellationError()])
        await #expect(throws: CancellationError.self) {
            try await Connection.retrying(after: delays) { try attempts.next() }
        }
        #expect(attempts.count == 1)
    }
}
