import Foundation
import Testing
@testable import Quai

struct PairingLinkHeaderTests {
    @Test func readsTheAddressesAndTheAccessHeaders() throws {
        let url = try #require(URL(string: "quai://pair?code=ABCD2345&url=http%3A%2F%2Fumbrel.local%3A3078&url=https%3A%2F%2Fquai.example.com&header=CF-Access-Client-Id%3A%20abc.access&header=CF-Access-Client-Secret%3A%20s3cr3t%2B%2F%3D%3D"))
        let link = try #require(PairingLink(url))
        #expect(link.code == "ABCD2345")
        #expect(link.serverURLs.map(\.absoluteString) == ["http://umbrel.local:3078", "https://quai.example.com"])
        #expect(link.accessHeaders == [
            AccessHeader(name: "CF-Access-Client-Id", value: "abc.access"),
            AccessHeader(name: "CF-Access-Client-Secret", value: "s3cr3t+/=="),
        ])
    }

    @Test func aLinkWithoutHeadersStillPairs() throws {
        let url = try #require(URL(string: "quai://pair?code=ABCD2345&url=http%3A%2F%2Fumbrel.local%3A3078"))
        let link = try #require(PairingLink(url))
        #expect(link.accessHeaders.isEmpty)
    }

    @Test func skipsAHeaderTheAppOwns() throws {
        let url = try #require(URL(string: "quai://pair?code=A&header=Authorization%3A%20x&header=X-Token%3A%20y"))
        let link = try #require(PairingLink(url))
        #expect(link.accessHeaders == [AccessHeader(name: "X-Token", value: "y")])
    }
}

struct AccessHeaderTests {
    @Test func acceptsAProxysHeader() {
        #expect(AccessHeader.problem(name: "CF-Access-Client-Id", value: "abc.access", among: []) == nil)
    }

    @Test func refusesWhatCantBeSent() {
        #expect(AccessHeader.problem(name: "Bad Name", value: "x", among: []) != nil)
        #expect(AccessHeader.problem(name: "", value: "x", among: []) != nil)
        #expect(AccessHeader.problem(name: "authorization", value: "x", among: []) != nil)
        #expect(AccessHeader.problem(name: "Host", value: "x", among: []) != nil)
        #expect(AccessHeader.problem(name: "X-Token", value: "", among: []) != nil)
        #expect(AccessHeader.problem(name: "X-Token", value: "a\nb", among: []) != nil)
        #expect(AccessHeader.problem(name: "x-token", value: "b", among: [AccessHeader(name: "X-Token", value: "a")]) != nil)
    }

    @Test func tellsTheProxyFromQuai() {
        // Quai answers JSON, its 401 (a removed iPhone) and 403 (a bad pairing code) included.
        #expect(!AccessHeadersMiddleware.isBlockedByProxy(status: 401, contentType: "application/json"))
        #expect(!AccessHeadersMiddleware.isBlockedByProxy(status: 403, contentType: "application/json; charset=utf-8"))
        #expect(!AccessHeadersMiddleware.isBlockedByProxy(status: 200, contentType: "application/json"))
        #expect(!AccessHeadersMiddleware.isBlockedByProxy(status: 204, contentType: nil))
        // A proxy's refusal, or its login page reached through a redirect.
        #expect(AccessHeadersMiddleware.isBlockedByProxy(status: 403, contentType: nil))
        #expect(AccessHeadersMiddleware.isBlockedByProxy(status: 401, contentType: "text/plain"))
        #expect(AccessHeadersMiddleware.isBlockedByProxy(status: 200, contentType: "text/html; charset=UTF-8"))
    }

    @Test func showsTheProxysRefusalThroughTheClientsWrapper() {
        #expect(ConnectionError.blockedByProxy.isBlockedByProxy)
        #expect(ConnectionError.blockedByProxy.quaiMessage.hasPrefix("Blocked by your proxy"))
    }
}
