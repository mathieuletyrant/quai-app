import Foundation
import Testing
@testable import Quai

struct JournalTests {
    @Test func decodesAPageOfTheJournal() throws {
        let json = #"{"entries":[{"id":"0001795150800000-c000001","at":1795150800000,"level":"error","source":"radarr","kind":"service.down","text":"Radarr hasn't answered for 5 minutes"}],"more":true,"kept":"home"}"#
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
