import Foundation
import Testing
@testable import Quai

struct FirstReachableTests {
    let local = URL(string: "http://umbrel.local:3078")!
    let publicURL = URL(string: "https://quai.example.com")!

    @Test func awayFromHomeThePublicAddressWinsWithoutWaitingForTheLocalOne() async throws {
        let local = self.local
        let started = ContinuousClock.now
        let url = try await ServerSession.firstReachable([local, publicURL]) { url in
            if url == local {
                try? await Task.sleep(for: .seconds(5))
                return .unreachable
            }
            return .reachable
        }
        #expect(url == publicURL)
        #expect(ContinuousClock.now - started < .seconds(2))
    }

    @Test func atHomeTheLocalAddressAnswersFirst() async throws {
        let publicURL = self.publicURL
        let url = try await ServerSession.firstReachable([local, publicURL]) { url in
            if url == publicURL { try? await Task.sleep(for: .milliseconds(200)) }
            return .reachable
        }
        #expect(url == local)
    }

    @Test func unreachableOnlyOnceEveryAddressFailed() async {
        await #expect(throws: ConnectionError.unreachable) {
            try await ServerSession.firstReachable([local, publicURL]) { _ in .unreachable }
        }
    }

    @Test func aProxyRefusalIsSaidWhenNothingElseAnswered() async {
        let publicURL = self.publicURL
        await #expect(throws: ConnectionError.blockedByProxy) {
            try await ServerSession.firstReachable([local, publicURL]) { url in url == publicURL ? .blocked : .unreachable }
        }
    }
}
