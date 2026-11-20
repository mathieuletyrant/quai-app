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
        let json = ##"{"key":"download|movie:tmdb:1","flowId":"download","title":"Dune","color":"#FFC230","icon":"arrow.down","steps":[{"id":"downloading","label":"Downloading","icon":"arrow.down"},{"id":"available","label":"Ready to watch","icon":"checkmark"}]}"##
        let attributes = try JSONDecoder().decode(QuaiActivityAttributes.self, from: Data(json.utf8))
        #expect(attributes.steps.map(\.id) == ["downloading", "available"])
    }
}

struct ActivityActionTests {
    @Test func namesMatchTheServersCatalog() {
        #expect(ActivityAction.allCases.map(\.rawValue) == ["playback.playPause", "playback.stop", "request.approve", "request.decline"])
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

struct TodayTests {
    private func activity(_ flowId: String, _ title: String, tone: String = "active", progress: Double? = nil) throws -> RunningActivity {
        let progressField = progress.map { #","progress":\#($0)"# } ?? ""
        let json = """
        {"attributes":{"key":"\(flowId)|\(title)","flowId":"\(flowId)","title":"\(title)","color":"#FFC230","icon":"arrow.down",\
        "steps":[{"id":"a","label":"Searching","icon":"magnifyingglass"},{"id":"b","label":"Downloading","icon":"arrow.down"}]},\
        "content":{"step":0,"tone":"\(tone)"\(progressField)}}
        """
        return try JSONDecoder().decode(RunningActivity.self, from: Data(json.utf8))
    }

    @Test func groupsActivitiesByWhatTheyFollow() throws {
        let today = try Today([
            activity("download", "Dune", progress: 0.2),
            activity("download", "Runner", progress: 0.6),
            activity("download", "Nero"),
            activity("download", "Severance", tone: "done"),
            activity("playback", "The Bear"),
            activity("incident", "Radarr"),
            activity("incident", "Sonarr", tone: "done"),
        ], subjects: ["download": .media, "playback": .playback, "incident": .service])
        #expect(today.downloading.map(\.attributes.title) == ["Runner", "Dune"])
        #expect(today.requested.map(\.attributes.title) == ["Nero"])
        #expect(today.ready.map(\.attributes.title) == ["Severance"])
        #expect(today.playing.map(\.attributes.title) == ["The Bear"])
        #expect(today.incidents.map(\.attributes.title) == ["Radarr"])
        #expect(!today.isEmpty)
    }

    @Test func anUnknownFlowIsMediaAndNothingIsEmpty() throws {
        #expect(Today([], subjects: [:]).isEmpty)
        let today = try Today([activity("anime", "Frieren")], subjects: [:])
        #expect(today.requested.count == 1)
    }
}

struct LibraryItemTests {
    @Test func decodesTheServersLibrary() throws {
        let json = #"{"items":[{"id":"movie:48","kind":"movie","title":"Runner","year":2026,"posterUrl":"https://image.tmdb.org/t/p/original/a.jpg","status":"downloading","progress":0.63,"addedAt":1795035524,"sizeBytes":0},{"id":"series:7","kind":"series","title":"The Bear","status":"available","sizeBytes":9663676416,"episodes":{"have":8,"total":8}}],"disk":{"freeBytes":759102349312,"totalBytes":1800360124416},"unavailable":[]}"#
        let library = try JSONDecoder().decode(Components.Schemas.Library.self, from: Data(json.utf8))
        #expect(library.items.map(\.caption) == ["Movie · 2026", "Series"])
        #expect(library.items[0].posterThumbnail?.absoluteString == "https://image.tmdb.org/t/p/w342/a.jpg")
        #expect(library.items[0].status == .downloading)
        #expect(library.items[1].episodes?.total == 8)
    }

    @Test func scopesAndFilters() throws {
        let json = #"[{"id":"movie:1","kind":"movie","title":"A","status":"wanted","sizeBytes":0},{"id":"series:2","kind":"series","title":"B","status":"available","sizeBytes":1}]"#
        let items = try JSONDecoder().decode([LibraryItem].self, from: Data(json.utf8))
        #expect(items.filter(LibraryScope.series.includes).map(\.id) == ["series:2"])
        #expect(items.filter(LibraryFilter.wanted.includes).map(\.id) == ["movie:1"])
    }
}
