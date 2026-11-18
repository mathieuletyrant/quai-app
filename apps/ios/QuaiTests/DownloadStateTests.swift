import Foundation
import Testing
@testable import Quai

struct DownloadStateTests {
    @Test func decodesTheServersContentState() throws {
        let json = #"{"step":"downloading","progress":0.5,"bytesPerSecond":1000,"remainingSeconds":60,"stalled":false}"#
        let state = try JSONDecoder().decode(DownloadActivityAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.step == .downloading)
        #expect(state.progress == 0.5)
    }

    @Test func leftOutValuesAreNil() throws {
        let json = #"{"step":"searching","stalled":false}"#
        let state = try JSONDecoder().decode(DownloadActivityAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.step == .searching)
        #expect(state.progress == nil)
    }

    @Test func everyServerStepIsKnown() {
        #expect(DownloadActivityAttributes.Step.allCases.map(\.rawValue) == ["searching", "downloading", "importing", "available"])
    }
}

struct PairingLinkTests {
    @Test func readsTheConsolesQRCode() throws {
        let url = try #require(URL(string: "quai://pair?code=ABCD2345&url=http%3A%2F%2Fumbrel.local%3A3078&url=https%3A%2F%2Fquai.example.com"))
        let link = try #require(PairingLink(url))
        #expect(link.code == "ABCD2345")
        #expect(link.serverURLs.map(\.absoluteString) == ["http://umbrel.local:3078", "https://quai.example.com"])
    }

    @Test func ignoresOtherLinks() throws {
        #expect(PairingLink(try #require(URL(string: "quai://other?code=X"))) == nil)
        #expect(PairingLink(try #require(URL(string: "quai://pair"))) == nil)
    }
}
