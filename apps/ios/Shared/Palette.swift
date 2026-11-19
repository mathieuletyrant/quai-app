import SwiftUI

/// Colors shared by the app and the Live Activity. Quai is dark only: these are its one theme.
enum Palette {
    static let accent = Color(hex: "#6FD3C2")
    /// Text and symbols drawn on the accent.
    static let onAccent = Color(hex: "#04201B")
    static let ready = Color(hex: "#30D158")
    static let stalled = Color(white: 0.55)
    static let track = Color.white.opacity(0.14)

    // Surfaces
    static let background = Color(hex: "#0B0B0F")
    /// Tiles and grouped lists.
    static let tile = Color(hex: "#1A1A20")
    /// Controls inside a tile (buttons, the selected segment, empty posters).
    static let raised = Color(hex: "#24242B")
    static let poster = Color(hex: "#1F1F26")
    static let separator = Color.white.opacity(0.06)

    // Text
    static let primaryText = Color(hex: "#F5F5F7")
    static let secondaryText = Color(hex: "#A1A1A6")
    static let tertiaryText = Color(hex: "#8E8E93")

    /// Progress bars' track inside a tile.
    static let barTrack = Color(hex: "#34343C")

    // What a tile is about
    static let downloads = Color(hex: "#FFC230")
    static let requests = Color(hex: "#8B8CF8")
    static let releases = Color(hex: "#4FC3F7")
    static let toFix = Color(hex: "#FF8A3D")
    static let playback = Color(hex: "#B57EDC")
    static let incident = Color(hex: "#FF6B5B")
    static let ok = Color(hex: "#30D158")

    /// The "wanted" badge on a poster.
    static let wantedFill = Color(hex: "#3A2A1E")
    static let wantedText = Color(hex: "#FFB36B")

    /// An activity's tint: its flow's color while active, grey when stalled, green when done.
    /// `tone` is the raw value both the ActivityKit state and the API client carry.
    static func tint(tone: String, color: String) -> Color {
        switch tone {
        case "stalled": stalled
        case "done": ready
        default: Color(hex: color)
        }
    }
}

extension Color {
    /// "#RRGGBB"; falls back to Quai's teal.
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x6FD3C2
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    static let quaiAccent = Palette.accent
}
