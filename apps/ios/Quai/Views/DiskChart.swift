import Charts
import SwiftUI

/// How a disk's chart draws its free space: in GB, or in TB from a terabyte free, with room under
/// the curve for the marks' lane, and round values on its left axis ("840", "820").
struct ChartScale: Equatable {
    /// Bytes per unit: 1e9 (GB) or 1e12 (TB), decimal like the rest of the app.
    let divisor: Double
    let unit: String
    /// The bottom of the curve's band; the marks' lane is under it, down to `floor`.
    let curveFloor: Double
    let floor: Double
    let ceiling: Double

    /// The lane's share of the chart's height.
    private static let lane = 0.14

    init(freeBytes: [Double]) {
        let highest = freeBytes.max() ?? 0
        divisor = highest >= 1e12 ? 1e12 : 1e9
        unit = divisor == 1e12 ? "TB" : "GB"
        let high = highest / divisor
        let low = (freeBytes.min() ?? 0) / divisor
        // A flat curve still gets some height: a hundredth of its value, or one unit.
        let padding = max((high - low) * 0.15, high * 0.01, divisor == 1e12 ? 0.01 : 1)
        ceiling = high + padding
        curveFloor = max(0, low - padding)
        floor = curveFloor - (ceiling - curveFloor) * Self.lane / (1 - Self.lane)
    }

    func value(_ bytes: Double) -> Double { bytes / divisor }

    /// The marks' ticks span the lane; a mark shown sits in its middle.
    var laneTop: Double { curveFloor - (curveFloor - floor) * 0.2 }
    var laneBottom: Double { floor + (curveFloor - floor) * 0.2 }
    var laneMiddle: Double { (floor + curveFloor) / 2 }

    /// About four round values over the curve's band: 1, 2 or 5 times a power of ten apart.
    var ticks: [Double] {
        let span = ceiling - curveFloor
        guard span > 0 else { return [] }
        let raw = span / 4
        let magnitude = pow(10, log10(raw).rounded(.down))
        let step = [1.0, 2, 5, 10].map { $0 * magnitude }.first { $0 >= raw } ?? raw
        var values: [Double] = []
        var tick = (curveFloor / step).rounded(.up) * step
        while tick <= ceiling + step * 1e-9 {
            values.append(tick)
            tick += step
        }
        return values
    }

    /// "840" in GB; "1.4" in TB.
    func label(_ value: Double) -> String {
        divisor == 1e12 ? value.formatted(.number.precision(.fractionLength(0...1))) : value.formatted(.number.precision(.fractionLength(0)))
    }
}

extension Components.Schemas.StorageDisk {
    /// The free space at a date: the last reading then, else the first one.
    func free(at date: Date) -> Double? {
        (readings.last { $0.date <= date } ?? readings.first)?.freeBytes
    }
}

/// A disk's free space over the period, its marks as ticks in a lane under the curve, the
/// selected one joined to the curve by a dashed line in its service's color.
struct DiskChart: View {
    let disk: StorageDisk
    let period: StoragePeriod
    let tint: Color
    /// The mark to show.
    let selected: String?
    /// A tap on the chart, at its date.
    let tapped: (Date) -> Void

    private var shown: DiskMark? { disk.marks.first { $0.id == selected } }

    /// From the first reading (or an earlier mark) to the last one.
    private var dates: ClosedRange<Date> {
        let all = disk.readings.map(\.date) + disk.marks.map(\.date)
        let start = all.min() ?? .now
        let end = max(all.max() ?? .now, start.addingTimeInterval(3600))
        return start...end
    }

    private var dateFormat: Date.FormatStyle {
        switch period {
        case .week: .dateTime.weekday(.abbreviated)
        case .month: .dateTime.month(.abbreviated).day()
        case .year, .all: .dateTime.month(.abbreviated)
        }
    }

    var body: some View {
        let scale = ChartScale(freeBytes: disk.readings.map(\.freeBytes))
        Chart {
            ForEach(disk.readings, id: \.at) { reading in
                AreaMark(
                    x: .value("Time", reading.date),
                    yStart: .value("Free", scale.curveFloor),
                    yEnd: .value("Free", scale.value(reading.freeBytes))
                )
                .foregroundStyle(tint.opacity(0.14))
                LineMark(x: .value("Time", reading.date), y: .value("Free", scale.value(reading.freeBytes)))
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
            }
            ForEach(disk.marks) { mark in
                RuleMark(
                    x: .value("Time", mark.date),
                    yStart: .value("Lane", scale.laneBottom),
                    yEnd: .value("Lane", scale.laneTop)
                )
                .foregroundStyle(mark.color)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
            }
            if let shown, let free = disk.free(at: shown.date) {
                RuleMark(
                    x: .value("Time", shown.date),
                    yStart: .value("Free", scale.value(free)),
                    yEnd: .value("Lane", scale.laneMiddle)
                )
                .foregroundStyle(shown.color)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                PointMark(x: .value("Time", shown.date), y: .value("Free", scale.value(free)))
                    .foregroundStyle(shown.color)
                    .symbolSize(30)
                PointMark(x: .value("Time", shown.date), y: .value("Lane", scale.laneMiddle))
                    .symbol { MarkBadge(mark: shown) }
            }
        }
        // Room after the last reading, so the last date under it isn't cut by the card's edge.
        .chartXScale(domain: dates, range: .plotDimension(endPadding: 20))
        .chartYScale(domain: scale.floor...scale.ceiling)
        .chartYAxis {
            AxisMarks(position: .leading, values: scale.ticks) { value in
                AxisGridLine().foregroundStyle(Palette.separator)
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(scale.label(number))
                            .font(QuaiFont.caption.monospacedDigit())
                            .foregroundStyle(Palette.tertiaryText)
                    }
                }
            }
        }
        .chartYAxisLabel(position: .topLeading) {
            Text(scale.unit)
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.tertiaryText)
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisValueLabel(format: dateFormat)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.tertiaryText)
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(Rectangle())
                    .onTapGesture { location in
                        guard let plot = proxy.plotFrame else { return }
                        let date: Date? = proxy.value(atX: location.x - geometry[plot].origin.x)
                        if let date { tapped(date) }
                    }
            }
        }
        .accessibilityLabel("\(disk.name): free space over time")
        .accessibilityValue("\(Format.bytes(disk.freeBytes)) free now, \(disk.marks.count) marks")
    }
}

/// A mark shown on the chart: a round in its service's color, its arrow inside.
private struct MarkBadge: View {
    let mark: DiskMark

    var body: some View {
        ZStack {
            Circle().fill(mark.color)
            Image(systemName: mark.symbol)
                .font(.system(size: 9, weight: .heavy))
                .foregroundStyle(mark.ink)
        }
        .frame(width: 18, height: 18)
    }
}
