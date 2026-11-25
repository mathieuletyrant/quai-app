import Foundation
import Testing
@testable import Quai

struct PendingPlaybackTests {
    private func playing(paused: Bool?, progress: Double? = nil) throws -> RunningActivity {
        let pausedField = paused.map { #","paused":\#($0)"# } ?? ""
        let progressField = progress.map { #","progress":\#($0)"# } ?? ""
        let json = """
        {"attributes":{"key":"playback|1","flowId":"playback","title":"Dune","color":"#B57EDC","icon":"play.fill",\
        "steps":[{"id":"playing","label":"Playing","icon":"play.fill","actions":["playback.playPause"]}]},\
        "content":{"step":0,"tone":"active","startsAt":1000,"endsAt":2000\(pausedField)\(progressField)}}
        """
        return try JSONDecoder().decode(RunningActivity.self, from: Data(json.utf8))
    }

    @Test func aTapShowsAtOnceAndHoldsUntilTheServerAgrees() throws {
        var pending = PendingPlayback()
        let now = Date(timeIntervalSince1970: 1500)
        try pending.toggle(playing(paused: nil), now: now)

        // The server hasn't seen the pause yet: the app still shows it, frozen where it was.
        let early = try pending.apply(to: [playing(paused: false)], now: now.addingTimeInterval(2))
        #expect(early[0].content.paused == true)
        #expect(early[0].content.progress == 0.5)

        // The server agrees: its state is shown, and the tap is forgotten.
        let agreed = try pending.apply(to: [playing(paused: true, progress: 0.51)], now: now.addingTimeInterval(4))
        #expect(agreed[0].content.progress == 0.51)
        let later = try pending.apply(to: [playing(paused: false)], now: now.addingTimeInterval(5))
        #expect(later[0].content.paused == false)
    }

    @Test func aTapTheServerNeverConfirmsWearsOff() throws {
        var pending = PendingPlayback()
        let now = Date(timeIntervalSince1970: 1500)
        try pending.toggle(playing(paused: nil), now: now)
        let shown = try pending.apply(to: [playing(paused: false)], now: now.addingTimeInterval(PendingPlayback.hold + 1))
        #expect(shown[0].content.paused == false)
    }

    @Test func resumingMovesTheTimelineOnFromWhereItStopped() throws {
        let content = try playing(paused: true, progress: 0.25).content
        let resumed = PendingPlayback.toggled(content, now: Date(timeIntervalSince1970: 5000))
        #expect(resumed.paused == false)
        #expect(resumed.startsAt == 4750)
        #expect(resumed.endsAt == 5750)
    }
}

struct PlaybackPositionTests {
    @Test func runsOnItsOwnAndFreezesWhenPaused() throws {
        let json = #"{"step":0,"tone":"active","startsAt":1000,"endsAt":2000}"#
        var content = try JSONDecoder().decode(Components.Schemas.ActivityContent.self, from: Data(json.utf8))
        let position = PlaybackPosition(content, at: Date(timeIntervalSince1970: 1250))
        #expect(position == PlaybackPosition(content, at: Date(timeIntervalSince1970: 1250)))
        #expect(position.progress == 0.25)
        #expect(position.elapsed == 250)
        #expect(position.left == 750)
        content.paused = true
        content.progress = 0.1
        #expect(PlaybackPosition(content, at: Date(timeIntervalSince1970: 1900)).progress == 0.1)
        #expect(Format.clock(3725) == "1:02:05")
        #expect(Format.clock(65) == "1:05")
    }
}
