import Foundation
import Testing
@testable import Quai

struct JournalTests {
    @Test func decodesAPageOfTheJournal() throws {
        let json = #"{"entries":[{"id":"0001795150800000-c000001","at":1795150800000,"level":"warn","source":"radarr","kind":"alert.raised","text":"Radarr isn't answering: No answer for 5 minutes"}],"more":true,"kept":"home"}"#
        let page = try JSONDecoder().decode(Components.Schemas.JournalPage.self, from: Data(json.utf8))
        #expect(page.more)
        #expect(page.entries[0].date == Date(timeIntervalSince1970: 1_795_150_800))
        #expect(page.entries[0].look.systemImage == "exclamationmark.triangle.fill")
    }
}

struct DiskReadingTests {
    @Test func readsHowFullTheDiskIs() throws {
        let json = #"{"freeBytes":300000000000,"totalBytes":2000000000000}"#
        let disk = DiskReading(try JSONDecoder().decode(Components.Schemas.DiskSpace.self, from: Data(json.utf8)))
        #expect(disk.usedShare == 0.85)
    }
}

struct AlertTests {
    @Test func decodesTheAlertsGoingOn() throws {
        let json = #"{"items":[{"id":"diskLow:disk:low","kind":"diskLow","title":"The media disk is running low","detail":"80 GB free (4%)","since":1795150800000}],"enabled":["serviceDown","diskLow"]}"#
        let alerts = try JSONDecoder().decode(Components.Schemas.ActiveAlerts.self, from: Data(json.utf8))
        #expect(alerts.items.map(\.kind) == [.diskLow])
        #expect(alerts.enabled == [.serviceDown, .diskLow])
        #expect(AlertKind.allCases.count == 3)
    }
}

struct ReadyTodayTests {
    @Test func listsWhatArrivedTodayButWhatOutTodayShows() throws {
        let now = Date(timeIntervalSince1970: 1_795_190_000)
        let today = 1_795_180_000_000.0
        let yesterday = 1_795_050_000_000.0
        let journal = try JSONDecoder().decode([JournalEntry].self, from: Data(#"""
        [{"id":"5","at":\#(today),"level":"info","source":"jellyfin","kind":"media.available","text":"Dune is available in Jellyfin","title":"Dune"},
         {"id":"4","at":\#(today),"level":"info","source":"jellyfin","kind":"media.available","text":"Percy is available","title":"Percy Jackson and the Olympians"},
         {"id":"3","at":\#(today),"level":"info","source":"radarr","kind":"media.grabbed","text":"Radarr grabbed Nero","title":"Nero"},
         {"id":"2","at":\#(today),"level":"info","source":"jellyfin","kind":"media.available","text":"Dune is available in Jellyfin","title":"Dune"},
         {"id":"1","at":\#(yesterday),"level":"info","source":"jellyfin","kind":"media.available","text":"Runner is available","title":"Runner"}]
        """#.utf8))
        let releases = try JSONDecoder().decode([DayRelease].self, from: Data(#"""
        [{"id":"episode:2","kind":"episode","title":"Percy Jackson and the Olympians","episode":"S03E01","airsAt":1795194000,"status":"available"}]
        """#.utf8))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
        #expect(ReadyToday.titles(journal, excluding: releases, now: now, calendar: calendar) == ["Dune"])
    }
}
