import Foundation
import Testing
@testable import Quai

struct ActivityStateTests {
    @Test func decodesTheServersContent() throws {
        let json = #"{"step":1,"tone":"active","progress":0.5,"bytesPerSecond":1000,"remainingSeconds":60}"#
        let state = try JSONDecoder().decode(QuaiActivityAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.step == 1)
        #expect(state.progress == 0.5)
        #expect(state.endsAt == nil)
    }

    @Test func decodesAPlaybackCountdown() throws {
        let json = #"{"step":0,"tone":"active","endsAt":1795020000,"detail":"TV Salon"}"#
        let state = try JSONDecoder().decode(QuaiActivityAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.endsAt == 1_795_020_000)
        #expect(state.detail == "TV Salon")
    }

    @Test func decodesTheAttributes() throws {
        let json = #"{"key":"download|movie:tmdb:1","flowId":"download","title":"Dune","color":"#FFC230","icon":"arrow.down","steps":[{"id":"downloading","label":"Downloading","icon":"arrow.down"},{"id":"available","label":"Ready to watch","icon":"checkmark"}]}"#
        let attributes = try JSONDecoder().decode(QuaiActivityAttributes.self, from: Data(json.utf8))
        #expect(attributes.steps.map(\.id) == ["downloading", "available"])
    }
}

struct ActivityActionTests {
    @Test func namesMatchTheServersCatalog() {
        #expect(ActivityAction.allCases.map(\.rawValue) == ["playback.playPause", "playback.stop"])
    }

    @Test func playPauseShowsWhatATapWillDo() {
        #expect(ActivityAction.playPause.symbol(paused: true) == "play.fill")
        #expect(ActivityAction.playPause.symbol(paused: false) == "pause.fill")
    }

    @Test func decodesAStepsButtons() throws {
        let json = #"{"id":"playing","label":"Playing","icon":"play.fill","actions":["playback.playPause","playback.stop"]}"#
        let step = try JSONDecoder().decode(QuaiActivityAttributes.Step.self, from: Data(json.utf8))
        #expect(step.actions?.compactMap(ActivityAction.init(rawValue:)) == [.playPause, .stop])
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
