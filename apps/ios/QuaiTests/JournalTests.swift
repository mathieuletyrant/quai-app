import Foundation
import Testing
@testable import Quai

struct JournalTests {
    @Test func decodesAPageOfTheJournal() throws {
        let json = #"{"entries":[{"id":"0001795150800000-c000001","at":1795150800000,"level":"warn","source":"radarr","kind":"alert.raised","text":"Radarr isn't answering: No answer for 5 minutes"}],"more":true,"kept":"home"}"#
        let page = try JSONDecoder().decode(Components.Schemas.JournalPage.self, from: Data(json.utf8))
        #expect(page.more)
        #expect(page.entries[0].date == Date(timeIntervalSince1970: 1_795_150_800))
        #expect(ServiceLook.name(page.entries[0].source.rawValue) == "Radarr")
    }

    @Test func groupsTheLinesByDayNewestFirst() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "Europe/Paris"))
        let now = Date(timeIntervalSince1970: 1_795_150_800) // Fri Nov 20, 2026, 06:00 in Paris
        let hour = 3_600_000.0
        let entries = [0.0, 2, 10, 20, 60].map { hoursAgo in
            JournalEntry(
                id: "\(hoursAgo)",
                at: now.timeIntervalSince1970 * 1000 - hoursAgo * hour,
                level: .info,
                source: .sonarr,
                kind: "media.imported",
                text: "Sonarr imported a title"
            )
        }
        let days = JournalDay.days(entries, now: now, calendar: calendar)
        #expect(days.map(\.entries.count) == [2, 2, 1])
        #expect(days.prefix(2).map(\.title) == ["Today", "Yesterday"])
    }
}

struct DiskReadingTests {
    @Test func readsHowFullTheDiskIs() throws {
        let json = #"{"freeBytes":300000000000,"totalBytes":2000000000000}"#
        let disk = try DiskReading(JSONDecoder().decode(Components.Schemas.DiskSpace.self, from: Data(json.utf8)))
        #expect(disk.usedShare == 0.85)
    }
}

struct AlertTests {
    @Test func decodesTheAlertsGoingOn() throws {
        let json = #"{"items":[{"id":"diskLow:disk:low","kind":"diskLow","title":"The media disk is running low","detail":"80 GB free (4%)","since":1795150800000}],"enabled":["serviceDown","diskLow"]}"#
        let alerts = try JSONDecoder().decode(Components.Schemas.ActiveAlerts.self, from: Data(json.utf8))
        #expect(alerts.items.map(\.kind) == [.diskLow])
        #expect(alerts.enabled == [.serviceDown, .diskLow])
        #expect(AlertKind.allCases.count == 4)
    }

    @Test func decodesAPlannedDeletion() throws {
        let json = #"{"items":[{"id":"plannedDeletion:reclaimerr:42","kind":"plannedDeletion","title":"Up will be deleted in 5 days","detail":"Unwatched for a year · Last watched more than 365 days ago","since":1795150800000}],"enabled":["plannedDeletion"]}"#
        let alerts = try JSONDecoder().decode(Components.Schemas.ActiveAlerts.self, from: Data(json.utf8))
        #expect(alerts.items.map(\.kind) == [.plannedDeletion])
        #expect(AlertKind.plannedDeletion.services == ["reclaimerr"])
        #expect(AlertKind.plannedDeletion.label == "A deletion is planned")
        #expect(GoneKind.seedCleanup.services == ["cleanuparr"])
    }
}

struct ServiceLookTests {
    @Test func namesTheServicesAndAnyService() {
        #expect(ServiceLook.names(["radarr", "sonarr"]) == "Radarr, Sonarr")
        #expect(ServiceLook.names([]) == "Any service")
        #expect(ServiceLook.name("home") == "Quai Home")
    }
}

struct NotificationRowsTests {
    @Test func offersOnlyWhatCanHappen() {
        let home = ["radarr", "prowlarr", "cleanuparr"]
        let alerts = NotificationRows.alerts(enabled: [.serviceDown, .diskLow, .arrHealth, .plannedDeletion], home: home)
        #expect(alerts.map(\.kind) == [.serviceDown, .diskLow, .arrHealth])
        #expect(alerts.map(\.services) == [[], ["radarr"], ["radarr", "prowlarr"]])
        #expect(NotificationRows.gone(home: home).map(\.kind) == [.stuckRemoval, .seedCleanup])
    }

    @Test func leavesOutTheAlertsTurnedOffInTheConsole() {
        let alerts = NotificationRows.alerts(enabled: [.serviceDown], home: ["radarr", "reclaimerr"])
        #expect(alerts.map(\.kind) == [.serviceDown])
    }

    @Test func offersEverythingWhileTheServicesAreUnknown() {
        #expect(NotificationRows.alerts(enabled: nil, home: nil).count == AlertKind.allCases.count)
        #expect(NotificationRows.gone(home: nil).count == GoneKind.allCases.count)
        #expect(NotificationRows.gone(home: []).isEmpty)
    }
}
