import SwiftUI

/// Colors shared by the app and the Live Activity.
enum Palette {
    static let accent = Color(hex: "#6FD3C2")
    static let ready = Color(hex: "#30D158")
    static let stalled = Color(white: 0.55)
    static let track = Color.white.opacity(0.14)

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
