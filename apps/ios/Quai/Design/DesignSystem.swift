import SwiftUI

/// Quai's type scale (the mockups': SF at fixed sizes, tabular digits where numbers move).
enum QuaiFont {
    static let largeTitle = Font.system(size: 34, weight: .bold)
    static let title = Font.system(size: 28, weight: .bold)
    /// The date above a large title, a section's header, a tile's label.
    static let eyebrow = Font.system(size: 13, weight: .semibold)
    static let headline = Font.system(size: 17, weight: .semibold)
    static let value = Font.system(size: 28, weight: .bold)
    static let body = Font.system(size: 16)
    static let bodyEmphasized = Font.system(size: 16, weight: .semibold)
    static let subheadline = Font.system(size: 15)
    static let caption = Font.system(size: 13)
}

enum Metrics {
    static let gutter: CGFloat = 16
    static let tileRadius: CGFloat = 26
    static let cardRadius: CGFloat = 22
    static let tileSpacing: CGFloat = 12
    /// Room under the scroll content for the floating tab bar.
    static let tabBarClearance: CGFloat = 24
}

// MARK: Screen

/// A tab's root: dark background, the large header, then the content, scrolling together.
struct Screen<Header: View, Content: View>: View {
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.tileSpacing) {
                header
                content
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 8)
            .padding(.bottom, Metrics.tabBarClearance)
        }
        .scrollIndicators(.hidden)
        .background(Palette.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// The large title of a screen, with its secondary date (or count) above or below it.
struct ScreenHeader<Trailing: View>: View {
    var eyebrow: String?
    var title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                if let eyebrow {
                    Text(eyebrow)
                        .font(QuaiFont.eyebrow)
                        .foregroundStyle(Palette.secondaryText)
                        .lineLimit(1)
                }
                Text(title)
                    .font(QuaiFont.largeTitle)
                    .tracking(-0.5)
                    .foregroundStyle(Palette.primaryText)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(QuaiFont.subheadline)
                        .foregroundStyle(Palette.secondaryText)
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 6)
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(eyebrow: String? = nil, title: String, subtitle: String? = nil) {
        self.init(eyebrow: eyebrow, title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// A tab's large title, the same on every tab so it never moves when switching: one eyebrow
/// line, always there (the date, a count, the connection), then the title.
struct TabHeader: View {
    let eyebrow: String
    let title: String

    var body: some View {
        ScreenHeader(eyebrow: eyebrow.isEmpty ? " " : eyebrow.uppercased(), title: title)
    }
}

extension Date {
    /// "WEDNESDAY, NOVEMBER 18": the eyebrow over a large title.
    var eyebrow: String {
        formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased()
    }
}

// MARK: Tiles and cards

/// A Home tile: the label, then what it's about.
struct Tile<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.tile, in: RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
    }
}

/// A tile's label: a colored symbol and a secondary title.
struct TileLabel: View {
    var title: String
    var systemImage: String
    var color: Color

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(color)
        }
        .labelStyle(TileLabelStyle())
    }
}

private struct TileLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 13, weight: .bold))
            configuration.title
        }
        .font(QuaiFont.eyebrow)
        .foregroundStyle(Palette.secondaryText)
    }
}

/// A block of content on a detail screen.
struct Card<Content: View>: View {
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.tile, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }
}

/// A thin progress bar on the tile's track.
struct ProgressBar: View {
    var value: Double
    var color: Color
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.barTrack)
                Capsule().fill(color).frame(width: geometry.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue(Text(value, format: .percent.precision(.fractionLength(0))))
    }
}

/// A small rounded tag on a poster or a row.
struct Badge: View {
    var text: String
    var fill: Color
    var color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(fill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

// MARK: Posters

/// TMDB lists the original poster (several MB): screens ask for one as wide as they show it.
/// Other hosts (TheTVDB) have one size: their URL is kept.
enum PosterSize: String {
    /// A row's thumbnail.
    case small = "w185"
    /// The Library grid.
    case grid = "w342"
    /// A title's detail.
    case large = "w500"

    func url(_ poster: String?) -> URL? {
        poster.flatMap { URL(string: $0.replacingOccurrences(of: "/t/p/original/", with: "/t/p/\(rawValue)/")) }
    }
}

/// A poster loaded from its public URL; the title on a plain tile until (or unless) it loads.
struct Poster: View {
    let url: URL?
    let title: String
    var cornerRadius: CGFloat = 12

    var body: some View {
        Color.clear
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .background(Palette.poster)
            .overlay {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Text(title)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Palette.tertiaryText)
                            .multilineTextAlignment(.center)
                            .padding(8)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A symbol on a black rounded square: a card's kind when it has no poster.
struct SymbolSquare: View {
    let systemImage: String
    let color: Color
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.47, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(Color.black, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A small 2:3 poster, with a symbol badge on its corner. `fallback` shows while it loads, when
/// it fails, and when there is no poster.
struct PosterThumbnail<Fallback: View>: View {
    let url: URL?
    var width: CGFloat = 52
    var cornerRadius: CGFloat = 10
    var badge: (systemImage: String, color: Color)?
    @ViewBuilder var fallback: Fallback

    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image
                    .resizable()
                    .scaledToFill()
                    .frame(width: width, height: width * 1.5)
                    .background(Palette.poster)
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                    .overlay(alignment: .bottomTrailing) {
                        if let badge {
                            Image(systemName: badge.systemImage)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(badge.color)
                                .frame(width: 22, height: 22)
                                .background(Color.black, in: Circle())
                                .overlay(Circle().strokeBorder(Palette.tile, lineWidth: 2))
                                .offset(x: 5, y: 5)
                        }
                    }
            } else {
                fallback
            }
        }
        .accessibilityHidden(true)
    }
}

/// A round glass button: a sheet's close, a pushed screen's back.
struct GlassIconButton: View {
    var systemImage: String
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Palette.primaryText)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        .accessibilityLabel(label)
    }
}

/// A full-width capsule button: the accent one for the main action, raised for the others.
struct PillButtonStyle: ButtonStyle {
    var prominent = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(prominent ? Palette.onAccent : Palette.primaryText)
            .background(prominent ? Palette.accent : Palette.raised, in: Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// What a screen shows when there is nothing yet, or an error.
struct MessageTile: View {
    var title: String
    var message: String
    var systemImage: String
    var color: Color = Palette.secondaryText

    var body: some View {
        Tile {
            TileLabel(title: title, systemImage: systemImage, color: color)
            Text(message)
                .font(QuaiFont.subheadline)
                .foregroundStyle(Palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: Grouped lists

/// The header over a group of rows: "ON THIS IPHONE".
struct SectionHeader: View {
    var title: String

    var body: some View {
        Text(title.uppercased())
            .font(QuaiFont.eyebrow)
            .foregroundStyle(Palette.secondaryText)
            .padding(.leading, 16)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Rows on one rounded tile, a hairline between each (the Settings screens).
struct GroupedSection<Content: View>: View {
    var header: String?
    var footer: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header { SectionHeader(title: header) }
            VStack(spacing: 0) {
                Group(subviews: content) { rows in
                    ForEach(rows) { row in
                        if row.id != rows.first?.id {
                            Rectangle().fill(Palette.separator).frame(height: 1)
                        }
                        row
                    }
                }
            }
            .background(Palette.tile, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
            if let footer {
                Text(footer)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// One row of a grouped list: an optional tinted symbol, a title, a value on the right.
struct ListRow<Trailing: View>: View {
    var title: String
    var systemImage: String?
    var iconColor: Color = Palette.accent
    var chevron = false
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(iconColor)
                    .frame(width: 30, height: 30)
                    .background(iconColor.opacity(0.18), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            Text(title)
                .font(QuaiFont.body)
                .foregroundStyle(Palette.primaryText)
            Spacer(minLength: 8)
            trailing
                .font(QuaiFont.subheadline)
                .foregroundStyle(Palette.secondaryText)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }
}

extension ListRow where Trailing == Text {
    init(title: String, systemImage: String? = nil, iconColor: Color = Palette.accent, value: String, chevron: Bool = false) {
        self.init(title: title, systemImage: systemImage, iconColor: iconColor, chevron: chevron) { Text(value) }
    }
}

extension ListRow where Trailing == EmptyView {
    init(title: String, systemImage: String? = nil, iconColor: Color = Palette.accent, chevron: Bool = false) {
        self.init(title: title, systemImage: systemImage, iconColor: iconColor, chevron: chevron) { EmptyView() }
    }
}

/// A labelled text field on Quai's dark surface.
struct FormField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(QuaiFont.eyebrow).foregroundStyle(Palette.secondaryText)
            content
                .font(QuaiFont.body)
                .foregroundStyle(Palette.primaryText)
                .padding(.horizontal, 14)
                .frame(height: 50)
                .background(Color(hex: "#16161C"), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        }
    }
}

// MARK: Formatting

enum Format {
    /// "12.4 MB/s"
    static func speed(_ bytesPerSecond: Double) -> String {
        Int64(bytesPerSecond).formatted(.byteCount(style: .file)) + "/s"
    }

    /// "759 GB"
    static func bytes(_ bytes: Double) -> String {
        Int64(bytes).formatted(.byteCount(style: .file))
    }

    /// "≈ 2 min", "≈ 1 hr 5 min"; under a minute: "< 1 min".
    static func remaining(_ seconds: Double) -> String {
        guard seconds >= 60 else { return "< 1 min" }
        let rounded = Duration.seconds(Int64(seconds / 60) * 60)
        return "≈ " + rounded.formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    static func percent(_ value: Double) -> String {
        value.formatted(.percent.precision(.fractionLength(0)))
    }
}
