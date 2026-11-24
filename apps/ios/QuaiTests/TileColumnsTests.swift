import CoreGraphics
import Testing
@testable import Quai

struct TileColumnsTests {
    @Test func oneColumnOnAnIPhoneTwoOnTheDuosInnerDisplay() {
        let count = { (width: CGFloat) in
            TileColumns.columnCount(width: width, minimum: Metrics.minTileWidth, spacing: Metrics.tileSpacing)
        }
        #expect(count(343) == 1)
        #expect(count(408) == 1)
        #expect(count(637) == 2)
    }

    @Test func threePostersAcrossOnEveryIPhoneMoreOnTheDuo() {
        let count = { (width: CGFloat) in
            TileColumns.columnCount(width: width, minimum: Metrics.minPosterWidth, spacing: 10)
        }
        #expect(count(343) == 3)
        #expect(count(408) == 3)
        #expect(count(637) == 5)
    }

    @Test func neverFewerThanOneColumn() {
        #expect(TileColumns.columnCount(width: 120, minimum: 300, spacing: 12) == 1)
        #expect(TileColumns.columnCount(width: .infinity, minimum: 300, spacing: 12) == 1)
    }

    @Test func eachTileGoesUnderTheShortestColumn() {
        let placed = TileColumns.place(heights: [200, 100, 120, 50], columns: 2, spacing: 12)
        #expect(placed.slots.map(\.column) == [0, 1, 1, 0])
        #expect(placed.slots.map(\.y) == [0, 0, 112, 212])
        #expect(placed.height == 262)
    }

    @Test func oneColumnStacksInOrder() {
        let placed = TileColumns.place(heights: [40, 60], columns: 1, spacing: 12)
        #expect(placed.slots.map(\.column) == [0, 0])
        #expect(placed.slots.map(\.y) == [0, 52])
        #expect(placed.height == 112)
    }
}
