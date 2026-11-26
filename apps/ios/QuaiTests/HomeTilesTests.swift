import Testing
@testable import Quai

struct HomeTilesTests {
    private func layout(_ order: [String], hidden: [String] = []) -> HomeLayout {
        HomeLayout(.init(order: order, hidden: hidden))
    }

    @Test func withoutPreferencesTheAppsOrderEveryTileShown() {
        #expect(HomeLayout.standard.rows == [
            .single(.toFix), .single(.requests), .single(.upcoming), .single(.alerts), .highlights, .single(.storage),
        ])
        #expect(HomeLayout.standard.hidden.isEmpty)
    }

    @Test func theIPhonesOrderThenTheTilesItDoesntListAndNamesItDoesntKnowSkipped() {
        let mine = layout(["storage", "aNewTile", "alerts", "storage"])
        #expect(mine.rows == [
            .single(.storage), .single(.alerts), .single(.toFix), .single(.requests), .single(.upcoming), .highlights,
        ])
    }

    @Test func recentlyAddedAndWantedShareTheRowWhereTheFirstOfThemIs() {
        let mine = layout(["wanted", "toFix", "recentlyAdded"])
        #expect(mine.rows.first == .highlights)
        #expect(mine.rows.filter { $0 == .highlights }.count == 1)
        #expect(HomeRow.highlights.tiles == [.recentlyAdded, .wanted])
    }

    @Test func aHiddenTileLeavesItsRowAndOneHalfOfThePairStays() {
        let mine = layout([], hidden: ["upcoming", "wanted", "unknown"])
        #expect(mine.hidden == [.upcoming, .wanted])
        #expect(mine.shown(.single(.upcoming)).isEmpty)
        #expect(mine.shown(.highlights) == [.recentlyAdded])
        #expect(mine.shown(.single(.storage)) == [.storage])
    }

    @Test func keptAsEveryTileInOrderTheHiddenOnesByName() {
        let mine = HomeLayout(rows: [.single(.storage), .highlights], hidden: [.wanted, .toFix])
        #expect(mine.preferences.order == ["storage", "recentlyAdded", "wanted"])
        #expect(mine.preferences.hidden == ["toFix", "wanted"])
        // Read back, the tiles it didn't list follow in the app's order.
        #expect(HomeLayout(mine.preferences).rows.prefix(2) == [.single(.storage), .highlights])
    }

    @Test func theSettingsListsTheRowsShownThenTheHiddenTilesOneByOne() {
        let mine = layout([], hidden: ["wanted", "alerts"])
        #expect(mine.shownRows == [.single(.toFix), .single(.requests), .single(.upcoming), .highlights, .single(.storage)])
        #expect(mine.hiddenTiles == [.alerts, .wanted])
        // Hiding the pair hides both; showing one puts it back in its row.
        let both = HomeLayout.standard.hiding(.highlights)
        #expect(both.hiddenTiles == [.recentlyAdded, .wanted])
        #expect(!both.shownRows.contains(.highlights))
        #expect(both.showing(.wanted).shown(.highlights) == [.wanted])
    }

    @Test func movingAShownRowLeavesTheHiddenRowsInTheirPlace() {
        // Alerts hidden, fourth row: Storage moved to the top of what's shown.
        let mine = layout([], hidden: ["alerts"]).moving(from: [4], to: 0)
        #expect(mine.rows == [
            .single(.storage), .single(.toFix), .single(.requests), .single(.alerts), .single(.upcoming), .highlights,
        ])
        #expect(mine.shownRows.first == .single(.storage))
    }
}
