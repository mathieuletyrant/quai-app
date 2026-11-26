import SwiftUI

/// The services of the stack as the app shows them: their name, and the colour of their logo
/// (a little brighter where the logo is too dark for a dark screen). Keyed by the name the API
/// gives a service ("radarr"), which every list of services shares.
enum ServiceLook {
    private static let knownNames: [String: String] = [
        "radarr": "Radarr", "sonarr": "Sonarr", "prowlarr": "Prowlarr", "qbittorrent": "qBittorrent",
        "jellyfin": "Jellyfin", "seerr": "Seerr", "reclaimerr": "Reclaimerr", "cleanuparr": "Cleanuparr",
        "apple": "Apple", "home": "Quai Home", "cloud": "Quai Cloud",
    ]

    private static let knownColors: [String: Color] = [
        "radarr": Color(hex: "#FFC230"), "sonarr": Color(hex: "#00CCFF"), "prowlarr": Color(hex: "#E0592A"),
        "qbittorrent": Color(hex: "#356EBF"), "jellyfin": Color(hex: "#AA5CC3"), "seerr": Color(hex: "#C395FC"),
        "reclaimerr": Color(hex: "#6366F1"), "cleanuparr": Color(hex: "#9B4DDB"),
    ]

    static func name(_ service: String) -> String { knownNames[service] ?? service }

    /// Quai's own parts (Quai Home, Quai Cloud) and Apple are grey.
    static func color(_ service: String) -> Color { knownColors[service] ?? Palette.secondaryText }

    /// "Radarr, Sonarr"; no service: "Any service".
    static func names(_ services: [String]) -> String {
        services.isEmpty ? "Any service" : services.map(name).joined(separator: ", ")
    }
}

/// A small dot in a service's colour; for several services, shared between them like a pie. No
/// service: grey.
struct ServiceDot: View {
    let services: [String]
    var size: CGFloat = 8

    var body: some View {
        Canvas { context, canvas in
            let colors = services.isEmpty ? [Palette.secondaryText] : services.map(ServiceLook.color)
            let center = CGPoint(x: canvas.width / 2, y: canvas.height / 2)
            let radius = min(canvas.width, canvas.height) / 2
            let share = 360 / Double(colors.count)
            for (index, color) in colors.enumerated() {
                var wedge = Path()
                wedge.move(to: center)
                wedge.addArc(
                    center: center,
                    radius: radius,
                    startAngle: .degrees(share * Double(index) - 90),
                    endAngle: .degrees(share * Double(index + 1) - 90),
                    clockwise: false
                )
                wedge.closeSubpath()
                context.fill(wedge, with: .color(color))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The quiet line under a row: who it's about (its dot and name), then when.
struct ServiceLine: View {
    let services: [String]
    var detail: Text?

    var body: some View {
        HStack(spacing: 6) {
            ServiceDot(services: services)
            HStack(spacing: 0) {
                Text(ServiceLook.names(services))
                if let detail {
                    Text(" · ")
                    detail
                }
            }
            .font(QuaiFont.caption)
            .foregroundStyle(Palette.secondaryText)
            .lineLimit(1)
        }
    }
}
