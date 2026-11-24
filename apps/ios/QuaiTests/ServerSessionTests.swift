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

    @Test func pairingKeepsTheCodesOrderAtHomeFirstWhicheverAnswered() {
        #expect(ServerSession.pairedURLs([local, publicURL], answered: publicURL) == [local, publicURL])
        let typed = URL(string: "http://192.168.1.10:3078")!
        #expect(ServerSession.pairedURLs([local, publicURL], answered: typed) == [typed, local, publicURL])
    }

    @Test func atHomeWhileQuaiAnswersAtItsFirstAddress() {
        #expect(ServerSession.isAtHome(local, in: [local, publicURL]))
        #expect(!ServerSession.isAtHome(publicURL, in: [local, publicURL]))
        #expect(!ServerSession.isAtHome(local, in: [local]))
        #expect(!ServerSession.isAtHome(nil, in: [local, publicURL]))
    }
}

struct ConsoleToOpenTests {
    let local = URL(string: "http://umbrel.local:3078")!
    let publicURL = URL(string: "https://quai.example.com")!

    @Test func atHomeTheLocalConsoleOpens() async {
        let url = await ServerSession.consoleToOpen([local, publicURL]) { _ in true }
        #expect(url == local)
    }

    @Test func awayFromHomeThePublicConsoleOpens() async {
        let local = self.local
        let url = await ServerSession.consoleToOpen([local, publicURL]) { $0 != local }
        #expect(url == publicURL)
    }

    @Test func aSingleAddressOpensWithoutAsking() async {
        let url = await ServerSession.consoleToOpen([local]) { _ in
            Issue.record("A single address isn't probed")
            return false
        }
        #expect(url == local)
    }

    @Test func noAddressNoConsole() async {
        let url = await ServerSession.consoleToOpen([]) { _ in true }
        #expect(url == nil)
    }
}
