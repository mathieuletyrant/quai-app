import Foundation
import Testing
@testable import Quai

struct StorageTests {
    private func disk(_ json: String) throws -> StorageDisk {
        try JSONDecoder().decode(StorageDisk.self, from: Data(json.utf8))
    }

    /// A disk with readings at these epoch seconds (free bytes as given) and two marks.
    private func disk(readings: [(Double, Double)] = [(1000, 8e11), (2000, 7.9e11)]) throws -> StorageDisk {
        let points = readings.map { #"{"at":\#($0.0 * 1000),"freeBytes":\#($0.1)}"# }.joined(separator: ",")
        return try disk(#"""
        {"id":"d1","name":"Movies · Shows","holds":["movies","shows"],"freeBytes":7.9e11,"totalBytes":1.96e12,"low":false,
         "readings":[\#(points)],
         "marks":[{"id":"a","at":1500000,"kind":"arrived","service":"radarr","title":"Dune","detail":"Imported","bytes":12000000000},
                  {"id":"g","at":3000000,"kind":"gone","service":"reclaimerr","title":"Up","detail":"Deleted"}],
         "allMarks":5}
        """#)
    }

    @Test func aTapPicksTheNearestMarkAndTheCurveIsReadAtItsDate() throws {
        let shown = try disk()
        #expect(shown.nearestMark(to: Date(timeIntervalSince1970: 1400))?.id == "a")
        #expect(shown.nearestMark(to: Date(timeIntervalSince1970: 2900))?.id == "g")
        // At a mark: the last reading then; before the first reading: the first.
        #expect(shown.free(at: Date(timeIntervalSince1970: 2500)) == 7.9e11)
        #expect(shown.free(at: Date(timeIntervalSince1970: 10)) == 8e11)
        #expect(try disk(readings: []).free(at: .now) == nil)
        // The cursor stops on the nearest reading, before or after.
        #expect(shown.reading(near: Date(timeIntervalSince1970: 1600))?.freeBytes == 7.9e11)
        #expect(shown.reading(near: Date(timeIntervalSince1970: 1400))?.freeBytes == 8e11)
        #expect(try disk(readings: []).reading(near: .now) == nil)
        #expect(shown.label == "MOVIES · SHOWS")
        // Taken by an import, back from what's gone; nothing when the size is unknown.
        #expect(shown.marks[0].sizeText?.hasPrefix("−") == true)
        #expect(shown.marks[1].sizeText == nil)
    }

    @Test func gigabytesWithRoundTicksAndALaneUnderTheCurve() {
        let scale = ChartScale(freeBytes: [7.86e11, 8.36e11])
        #expect(scale.unit == "GB")
        #expect(scale.label(840) == "840")
        #expect(scale.ticks.allSatisfy { $0 >= scale.curveFloor && $0 <= scale.ceiling })
        #expect(scale.ticks.count >= 3)
        #expect(scale.ticks.count <= 5)
        // Ticks are a round step apart: 20 GB here.
        let steps = zip(scale.ticks.dropFirst(), scale.ticks).map { $0 - $1 }
        #expect(steps.allSatisfy { abs($0 - 20) < 1e-6 })
        #expect(scale.floor < scale.laneBottom)
        #expect(scale.laneBottom < scale.laneMiddle)
        #expect(scale.laneMiddle < scale.laneTop)
        #expect(scale.laneTop < scale.curveFloor)
        #expect(scale.value(8.36e11) < scale.ceiling)
    }

    @Test func terabytesFromATerabyteFreeAndAFlatCurveStillHasHeight() {
        let large = ChartScale(freeBytes: [1.39e12, 1.69e12])
        #expect(large.unit == "TB")
        #expect(large.label(1.4) == "1.4")
        let flat = ChartScale(freeBytes: [5e11, 5e11])
        #expect(flat.ceiling > flat.curveFloor)
        #expect(!flat.ticks.isEmpty)
        let empty = ChartScale(freeBytes: [])
        #expect(empty.ceiling > empty.floor)
    }

    @Test func thePeriodsAsTheContractNamesThem() {
        #expect(StoragePeriod.allCases.map(\.title) == ["7 D", "30 D", "1 Y", "All"])
        #expect(StoragePeriod.allCases.filter(\.isHourly) == [.week, .month])
        #expect(StoragePeriod.allCases.allSatisfy { $0.api?.rawValue == $0.rawValue })
    }
}
