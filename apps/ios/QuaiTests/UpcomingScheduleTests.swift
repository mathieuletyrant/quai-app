import Foundation
import Testing
@testable import Quai

struct UpcomingScheduleTests {
    /// Wednesday Nov 25, 2026, 11:00 in Paris.
    private let schedule = UpcomingSchedule(now: Date(timeIntervalSince1970: 1795600800), timeZone: "Europe/Paris")

    private func item(_ json: String) throws -> UpcomingItem {
        try JSONDecoder().decode(UpcomingItem.self, from: Data(json.utf8))
    }

    @Test func todaySaysTheTimeOnly() throws {
        let episode = try item(#"{"id":"r1","kind":"releaseDay","service":"sonarr","title":"Severance","episode":"S02E05","at":1795636800,"timed":true,"earliest":false}"#)
        #expect(schedule.when(episode) == "21:00")
        #expect(schedule.period(episode) == .today)
        let movie = try item(#"{"id":"r2","kind":"releaseDay","service":"radarr","title":"Dune","at":1795561200,"timed":false,"earliest":false}"#)
        #expect(schedule.when(movie) == "Out today")
        let removal = try item(#"{"id":"x","kind":"stuckRemoval","service":"cleanuparr","title":"Lost","at":1795613400,"timed":true,"earliest":true,"fixId":"removal-1"}"#)
        #expect(schedule.when(removal) == "Earliest 14:30")
    }

    @Test func otherDaysSayTheDayAndARangeFitsOnOneLine() throws {
        let deletion = try item(#"{"id":"d","kind":"plannedDeletion","service":"reclaimerr","title":"Runner","at":1796032800,"timed":false,"earliest":false,"fixId":"deletion-9"}"#)
        #expect(schedule.when(deletion) == "Mon Nov 30")
        let week = try item(#"{"id":"s","kind":"seedCleanup","service":"cleanuparr","title":"5 torrents","at":1795683600,"until":1795942800,"timed":false,"earliest":false,"count":5}"#)
        #expect(schedule.when(week) == "Thu–Sun, Nov 26–29")
        let acrossMonths = try item(#"{"id":"s2","kind":"seedCleanup","service":"cleanuparr","title":"2 torrents","at":1796032800,"until":1796547600,"timed":false,"earliest":false,"count":2}"#)
        #expect(schedule.when(acrossMonths) == "Mon Nov 30 – Sun Dec 6")
        // A week starting today still says its days.
        let thisWeek = try item(#"{"id":"s4","kind":"seedCleanup","service":"cleanuparr","title":"3 torrents","at":1795613400,"until":1795942800,"timed":false,"earliest":false,"count":3}"#)
        #expect(schedule.when(thisWeek) == "Wed–Sun, Nov 25–29")
        let byRatio = try item(#"{"id":"s3","kind":"seedCleanup","service":"cleanuparr","title":"1 torrent","timed":false,"earliest":false,"count":1}"#)
        #expect(schedule.period(byRatio) == .byRatio)
    }

    @Test func periodsCountDaysFromToday() throws {
        let at = { (seconds: Int) in try self.item(#"{"id":"\#(seconds)","kind":"plannedDeletion","service":"reclaimerr","title":"T","at":\#(seconds),"timed":false,"earliest":false}"#) }
        #expect(schedule.period(try at(1795683600)) == .thisWeek)
        #expect(schedule.period(try at(1797415200)) == .thisMonth)
        #expect(schedule.period(try at(1802426400)) == .later)
        let groups = schedule.periods([try at(1802426400), try at(1795683600), try at(1797415200)])
        #expect(groups.map(\.period) == [.thisWeek, .thisMonth, .later])
    }

    @Test func saysWhatGoesThisWeek() throws {
        let deletion = try item(#"{"id":"d","kind":"plannedDeletion","service":"reclaimerr","title":"Runner","at":1796032800,"timed":false,"earliest":false}"#)
        let release = try item(#"{"id":"r","kind":"releaseDay","service":"radarr","title":"Dune","at":1795683600,"timed":false,"earliest":false}"#)
        #expect(schedule.goingThisWeek([deletion, release]) == "1 Reclaimerr deletion this week")
        let seed = try item(#"{"id":"s","kind":"seedCleanup","service":"cleanuparr","title":"5 torrents","at":1795683600,"timed":false,"earliest":false,"count":5}"#)
        #expect(schedule.goingThisWeek([deletion, seed]) == "2 going this week")
        #expect(schedule.goingThisWeek([release]) == nil)
    }

    @Test func saysTheFreedSpaceAfterTheDateOnlyWhenItComesBack() throws {
        let freeing = try item(#"{"id":"d","kind":"plannedDeletion","service":"reclaimerr","title":"Vampire Diaries S06","at":1796032800,"timed":false,"earliest":false,"freesBytes":24491050987}"#)
        #expect(freeing.freedText == "· +" + Format.bytes(24_491_050_987))
        let keeping = try item(#"{"id":"k","kind":"plannedDeletion","service":"reclaimerr","title":"Runner","at":1796032800,"timed":false,"earliest":false}"#)
        #expect(keeping.freedText == nil)
    }
}
