import SwiftUI

/// The tiles of a screen in as many columns as its width holds: one on an iPhone, two on the
/// iPhone Duo's inner display. Each tile goes under the shortest column so far, in order.
struct TileColumns: Layout {
    var spacing: CGFloat = Metrics.tileSpacing
    var minColumnWidth: CGFloat = Metrics.minTileWidth

    /// How many columns of at least `minimum` fit in `width`, `spacing` apart, never fewer than one.
    static func columnCount(width: CGFloat, minimum: CGFloat, spacing: CGFloat) -> Int {
        guard width.isFinite, minimum > 0 else { return 1 }
        return max(1, Int((width + spacing) / (minimum + spacing)))
    }

    /// Where a tile goes: its column and its top.
    struct Slot: Equatable {
        let column: Int
        let y: CGFloat
    }

    /// Where each tile goes, from the tiles' heights at the column width, and the total height.
    static func place(heights: [CGFloat], columns: Int, spacing: CGFloat) -> (slots: [Slot], height: CGFloat) {
        var bottoms: [CGFloat?] = Array(repeating: nil, count: max(1, columns))
        var slots: [Slot] = []
        for height in heights {
            let column = bottoms.indices.min { (bottoms[$0] ?? -1) < (bottoms[$1] ?? -1) } ?? 0
            let y = bottoms[column].map { $0 + spacing } ?? 0
            slots.append(Slot(column: column, y: y))
            bottoms[column] = y + height
        }
        return (slots, bottoms.compactMap { $0 }.max() ?? 0)
    }

    private func arrangement(width: CGFloat, subviews: Subviews) -> (columnWidth: CGFloat, slots: [Slot], height: CGFloat) {
        let count = Self.columnCount(width: width, minimum: minColumnWidth, spacing: spacing)
        let columns = min(count, max(1, subviews.count))
        let columnWidth = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil)).height }
        let placed = Self.place(heights: heights, columns: columns, spacing: spacing)
        return (columnWidth, placed.slots, placed.height)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.replacingUnspecifiedDimensions().width
        return CGSize(width: width, height: arrangement(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let arranged = arrangement(width: bounds.width, subviews: subviews)
        for (subview, slot) in zip(subviews, arranged.slots) {
            let x = bounds.minX + CGFloat(slot.column) * (arranged.columnWidth + spacing)
            subview.place(
                at: CGPoint(x: x, y: bounds.minY + slot.y),
                proposal: ProposedViewSize(width: arranged.columnWidth, height: nil)
            )
        }
    }
}
