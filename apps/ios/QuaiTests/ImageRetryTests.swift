import Foundation
import Testing
@testable import Quai

/// A poster that failed loads again on its own while its view is on screen.
@MainActor
struct ImageRetryTests {
    /// Fails with these errors in turn, then answers 42; counts its attempts.
    private final class Attempts {
        var failures: [any Error]
        var tries = 0

        init(_ failures: [any Error]) { self.failures = failures }

        func next() throws -> Int {
            tries += 1
            if failures.isEmpty { return 42 }
            throw failures.removeFirst()
        }
    }

    @Test func aPosterLostWithTheNetworkLoadsWhenItIsBack() async throws {
        // More failures than delays: the last delay repeats, the tries never give up.
        let attempts = Attempts([
            URLError(.networkConnectionLost), URLError(.notConnectedToInternet),
            URLError(.timedOut), URLError(.badServerResponse),
        ])
        var failures = 0
        let value = try await ImageStore.keepTrying(after: [.zero, .zero]) {
            try attempts.next()
        } failed: {
            failures += 1
        }
        #expect(value == 42)
        #expect(attempts.tries == 5)
        #expect(failures == 4)
    }

    @Test func aPosterThatLoadsIsTriedOnce() async throws {
        let attempts = Attempts([])
        var failures = 0
        let value = try await ImageStore.keepTrying(after: [.zero]) { try attempts.next() } failed: { failures += 1 }
        #expect(value == 42)
        #expect(attempts.tries == 1)
        #expect(failures == 0)
    }

    @Test func aViewThatLeftStopsTrying() async {
        let attempts = Attempts([URLError(.timedOut), CancellationError()])
        await #expect(throws: CancellationError.self) {
            try await ImageStore.keepTrying(after: [.zero]) { try attempts.next() }
        }
        #expect(attempts.tries == 2)
    }

    @Test func noTryAfterTheTaskIsCancelled() async {
        let attempts = Attempts([])
        let task = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            return try await ImageStore.keepTrying(after: [.zero]) { try attempts.next() }
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(attempts.tries == 0)
    }
}
