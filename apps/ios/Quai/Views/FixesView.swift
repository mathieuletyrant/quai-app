import SwiftUI

typealias Fix = Components.Schemas.Fix
typealias FixRelease = Components.Schemas.Release

extension Components.Schemas.Fix: Identifiable {}

extension Components.Schemas.Release: Identifiable {
    var id: String { guid }
}

extension Components.Schemas.Fix {
    /// The kind's symbol and color, as in the mockups.
    var symbol: (name: String, color: Color) {
        switch kind {
        case .plannedDeletion: ("trash", Palette.toFix)
        case .stuckRemoval: ("xmark.bin", Palette.downloads)
        case .noSource: ("magnifyingglass", Palette.downloads)
        case .importBlocked: ("exclamationmark.triangle", Palette.incident)
        }
    }

    var serviceName: String { service.name }

    /// "Up will be deleted in 5 days", "The Wild Robot may leave the queue in 4 min", "Runner, still without a file", "Import blocked · Mouse"
    var headline: String {
        switch kind {
        case .plannedDeletion:
            let verb = deletion?.operation == .move ? "moved" : "deleted"
            return "\(title) will be \(verb) \(Fix.when(deletion?.deletesAt ?? 0))"
        case .stuckRemoval:
            return "\(title) may leave the queue \(Fix.soon(removal?.removesAt))"
        case .noSource:
            return "\(title), still without a file"
        case .importBlocked:
            return "Import blocked · \(title)"
        }
    }

    /// "Radarr · No release grabbed since it was added · for 3 h", "Cleanuparr · Stalled, no progress · 2 of 3 strikes"
    var detail: String {
        var parts = [serviceName, reason]
        if kind == .noSource, let since {
            parts.append("for " + Fix.elapsed(since))
        }
        if kind == .stuckRemoval, let removal {
            parts.append("\(removal.strikes) of \(removal.maxStrikes) strikes")
        }
        return parts.joined(separator: " · ")
    }

    func offers(_ action: Components.Schemas.FixAction) -> Bool { actions.contains(action) }

    private static func when(_ deletesAt: Double) -> String {
        let left = deletesAt - Date.now.timeIntervalSince1970
        if left <= 0 { return "at the next cleanup" }
        if left < 86_400 { return "within a day" }
        let days = Int((left / 86_400).rounded())
        return days == 1 ? "tomorrow" : "in \(days) days"
    }

    /// When Cleanuparr strikes next: its next queue cleaning, minutes or hours away.
    private static func soon(_ removesAt: Double?) -> String {
        guard let removesAt else { return "at Cleanuparr's next strike" }
        let minutes = Int(((removesAt - Date.now.timeIntervalSince1970) / 60).rounded(.up))
        if minutes <= 1 { return "within a minute" }
        if minutes < 120 { return "in \(minutes) min" }
        return "in \(minutes / 60) h"
    }

    private static func elapsed(_ since: Double) -> String {
        let minutes = max(0, Int((Date.now.timeIntervalSince1970 - since) / 60))
        if minutes < 60 { return "\(minutes) min" }
        if minutes < 2880 { return "\(minutes / 60) h" }
        return "\(minutes / 1440) days"
    }
}

extension Components.Schemas.FixService {
    /// The service as the app names it.
    var name: String {
        switch self {
        case .radarr: "Radarr"
        case .sonarr: "Sonarr"
        case .reclaimerr: "Reclaimerr"
        case .cleanuparr: "Cleanuparr"
        }
    }
}

/// What a card opens over the list.
private enum FixSheet: Identifiable {
    case releases(Fix)
    case importing(Fix)

    var id: String {
        switch self {
        case let .releases(fix): "releases-\(fix.id)"
        case let .importing(fix): "import-\(fix.id)"
        }
    }
}

/// The To fix screen: one card per problem, each with its one-tap fixes.
struct FixesView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: FixSheet?
    @State private var removing: Fix?
    @State private var working: String?
    @State private var failure: String?

    private var items: [Fix] { connection.fixes?.items ?? [] }

    private var summary: String? {
        guard let fixes = connection.fixes else { return nil }
        if fixes.items.isEmpty { return "Nothing to fix" }
        return "\(fixes.items.count) to fix · each settled in one tap"
    }

    var body: some View {
        Screen {
            HStack {
                GlassIconButton(systemImage: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            ScreenHeader(title: "To fix", subtitle: summary)
        } content: {
            if let error = connection.fixesError {
                MessageTile(title: "Can't load the list", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            if let unavailable = connection.fixes?.unavailable, !unavailable.isEmpty {
                Text(unavailableNote(unavailable))
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 4)
            }
            if connection.fixes == nil && connection.fixesError == nil {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            } else if connection.fixes != nil && items.isEmpty {
                MessageTile(
                    title: "All clear",
                    message: "No blocked import, every title has a source, and nothing is about to be deleted or removed from the queue.",
                    systemImage: "checkmark.seal.fill",
                    color: Palette.ok
                )
            }
            ForEach(items) { fix in
                FixCard(fix: fix, busy: working == fix.id) { action in perform(action, on: fix) }
            }
        }
        .refreshable { await connection.loadFixes() }
        .task { await connection.loadFixes() }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case let .releases(fix):
                ReleasesSheet(fix: fix)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            case let .importing(fix):
                ImportSheet(fix: fix)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
        .confirmationDialog(
            "Remove this download?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { fix in
            Button("Remove", role: .destructive) { run(fix) { try await connection.removeDownload(fix, blocklist: false) } }
            Button("Remove and blocklist", role: .destructive) { run(fix) { try await connection.removeDownload(fix, blocklist: true) } }
            Button("Cancel", role: .cancel) {}
        } message: { fix in
            Text("\(fix.download?.release ?? fix.title) leaves the queue and the download client. Blocklisting it keeps \(fix.serviceName) from grabbing it again.")
        }
        .alert("Couldn't fix it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func perform(_ action: FixCardAction, on fix: Fix) {
        switch action {
        case .keep: run(fix) { try await connection.keep(fix) }
        case .letGo: run(fix) { try await connection.letGo(fix) }
        case let .ignoreAndWait(days): run(fix) { try await connection.ignoreAndWait(fix, days: days) }
        case .searchReleases: sheet = .releases(fix)
        case .importAnyway: sheet = .importing(fix)
        case .remove: removing = fix
        }
    }

    private func run(_ fix: Fix, _ work: @escaping @MainActor () async throws -> Void) {
        working = fix.id
        Task {
            do { try await work() } catch { failure = error.message(replacing: failure) }
            working = nil
        }
    }

    private func unavailableNote(_ services: [Components.Schemas.FixService]) -> String {
        let names = services.map(\.name)
        return "\(names.joined(separator: " and ")) didn't answer: \(services.count == 1 ? "its" : "their") problems are missing. Pull to try again."
    }
}

enum FixCardAction {
    case keep, letGo, searchReleases, importAnyway, remove
    /// `nil`: until a release is grabbed.
    case ignoreAndWait(days: Int?)
}

/// The title's poster with the kind's symbol on its corner; the symbol alone without a poster.
struct FixPoster: View {
    let fix: Fix
    var width: CGFloat = 52
    var fallbackSize: CGFloat = 34

    /// A thumbnail too small for a badge goes without.
    private var badge: (systemImage: String, color: Color)? {
        guard width >= 40 else { return nil }
        return (systemImage: fix.symbol.name, color: fix.symbol.color)
    }

    var body: some View {
        PosterThumbnail(url: PosterSize.small.url(fix.posterUrl), width: width, cornerRadius: width * 0.2, badge: badge) {
            SymbolSquare(systemImage: fix.symbol.name, color: fix.symbol.color, size: fallbackSize)
        }
    }
}

/// One problem: its poster, what's wrong, and its buttons (the main one in the accent).
private struct FixCard: View {
    let fix: Fix
    let busy: Bool
    let act: (FixCardAction) -> Void

    var body: some View {
        Card(spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                FixPoster(fix: fix)
                VStack(alignment: .leading, spacing: 3) {
                    Text(fix.headline)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Palette.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(fix.detail)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if busy { ProgressView() }
            }
            .accessibilityElement(children: .combine)
            HStack(spacing: 8) { buttons }
                .disabled(busy)
        }
    }

    @ViewBuilder private var buttons: some View {
        switch fix.kind {
        case .plannedDeletion, .stuckRemoval:
            if fix.offers(.keep) { Button("Keep") { act(.keep) }.buttonStyle(FixButtonStyle()) }
            if fix.offers(.letGo) { Button("Let it go") { act(.letGo) }.buttonStyle(FixButtonStyle(prominent: false)) }
        case .noSource:
            if fix.offers(.searchReleases) { Button("Search releases") { act(.searchReleases) }.buttonStyle(FixButtonStyle()) }
            if fix.offers(.ignoreAndWait) {
                Menu {
                    Button("Until a release is grabbed") { act(.ignoreAndWait(days: nil)) }
                    Button("For a day") { act(.ignoreAndWait(days: 1)) }
                    Button("For a week") { act(.ignoreAndWait(days: 7)) }
                } label: {
                    Text("Ignore and wait").modifier(FixButtonLabel(prominent: false))
                }
            }
        case .importBlocked:
            if fix.offers(.importAnyway) { Button("Import anyway") { act(.importAnyway) }.buttonStyle(FixButtonStyle()) }
            if fix.offers(.remove) { Button("Remove") { act(.remove) }.buttonStyle(FixButtonStyle(prominent: !fix.offers(.importAnyway))) }
        }
    }
}

/// A card's capsule button: 40 pt, the accent for the main action, raised for the others.
struct FixButtonStyle: ButtonStyle {
    var prominent = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(FixButtonLabel(prominent: prominent))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct FixButtonLabel: ViewModifier {
    var prominent: Bool

    func body(content: Content) -> some View {
        content
            .font(.system(size: 14, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 40)
            .foregroundStyle(prominent ? Palette.onAccent : Palette.primaryText)
            .background(prominent ? Palette.accent : Palette.raised, in: Capsule())
            .contentShape(Capsule())
    }
}

/// A sheet's title row, with its close button.
private struct SheetHeader: View {
    let title: String
    let subtitle: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(QuaiFont.title).tracking(-0.3).foregroundStyle(Palette.primaryText)
                Text(subtitle).font(QuaiFont.subheadline).foregroundStyle(Palette.secondaryText)
            }
            Spacer(minLength: 12)
            GlassIconButton(systemImage: "xmark", label: "Close") { dismiss() }
        }
    }
}

/// The releases the indexers have for a title without a file; Grab one.
private struct ReleasesSheet: View {
    let fix: Fix
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var releases: [FixRelease]?
    @State private var failure: String?
    @State private var grabbing: String?
    @State private var confirming: FixRelease?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SheetHeader(title: "Releases", subtitle: fix.title)
                if let failure {
                    MessageTile(title: "Couldn't search", message: failure, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if let releases {
                    if releases.isEmpty {
                        MessageTile(
                            title: "No release found",
                            message: "None of the indexers has it right now. Ignore it and wait: it comes back if nothing is grabbed.",
                            systemImage: "magnifyingglass",
                            color: Palette.downloads
                        )
                    }
                    ForEach(releases) { release in
                        ReleaseRow(release: release, grabbing: grabbing == release.guid) {
                            if release.rejected { confirming = release } else { grab(release) }
                        }
                        .disabled(grabbing != nil)
                    }
                } else if failure == nil {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Asking the indexers… it can take up to a minute.")
                            .font(QuaiFont.caption)
                            .foregroundStyle(Palette.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                }
            }
            .padding(Metrics.gutter)
        }
        .scrollIndicators(.hidden)
        .background(Palette.background.ignoresSafeArea())
        .task {
            do { releases = try await connection.releases(fix) } catch { failure = error.message(replacing: failure) }
        }
        .alert(
            "Grab it anyway?",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { release in
            Button("Grab") { grab(release) }
            Button("Cancel", role: .cancel) {}
        } message: { release in
            Text("\(fix.serviceName) rejected it: \(release.rejections.joined(separator: " · "))")
        }
    }

    private func grab(_ release: FixRelease) {
        grabbing = release.guid
        Task {
            do {
                try await connection.grab(release, for: fix)
                dismiss()
            } catch {
                failure = error.message(replacing: failure)
            }
            grabbing = nil
        }
    }
}

/// One release: its name, where from, how big, and its Grab button.
private struct ReleaseRow: View {
    let release: FixRelease
    let grabbing: Bool
    let grab: () -> Void

    private var facts: String {
        var parts = [release.indexer]
        if !release.languages.isEmpty { parts.append(release.languages.joined(separator: ", ")) }
        parts.append(Format.bytes(release.sizeBytes))
        if let seeders = release.seeders { parts.append("\(seeders) seeders") }
        parts.append(release.ageHours < 24 ? "\(Int(release.ageHours)) h" : "\(Int(release.ageHours / 24)) d")
        return parts.joined(separator: " · ")
    }

    var body: some View {
        Card(spacing: 8) {
            Text(release.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.primaryText)
                .lineLimit(3)
            HStack(spacing: 8) {
                Badge(
                    text: release.quality,
                    fill: release.rejected ? Palette.raised : Palette.accent.opacity(0.18),
                    color: release.rejected ? Palette.secondaryText : Palette.accent
                )
                Text(facts)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .lineLimit(2)
            }
            if let rejection = release.rejections.first {
                Text(rejection)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.wantedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: grab) {
                if grabbing { ProgressView().tint(Palette.onAccent) } else { Text("Grab") }
            }
            .buttonStyle(FixButtonStyle(prominent: !release.rejected))
        }
    }
}

/// Import anyway: the download's files, why they were refused, and the episode to choose.
private struct ImportSheet: View {
    let fix: Fix
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var preview: Components.Schemas.ImportPreview?
    @State private var failure: String?
    @State private var chosen: [String: Int] = [:]
    @State private var confirming = false
    @State private var importing = false

    private var ready: Bool {
        guard let preview, !preview.files.isEmpty else { return false }
        return preview.files.allSatisfy { !$0.needsEpisodes || chosen[$0.file] != nil }
    }

    private var rejections: String {
        let all = preview?.files.flatMap(\.rejections) ?? []
        var seen = Set<String>()
        return all.filter { seen.insert($0).inserted }.joined(separator: "\n")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SheetHeader(title: "Import anyway", subtitle: fix.title)
                if let failure {
                    MessageTile(title: "Couldn't import", message: failure, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if let preview {
                    ForEach(preview.files, id: \.file) { file in
                        Card(spacing: 8) {
                            Text(file.file)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Palette.primaryText)
                                .lineLimit(3)
                            if let quality = file.quality {
                                Text(([quality] + file.episodes).joined(separator: " · "))
                                    .font(QuaiFont.caption)
                                    .foregroundStyle(Palette.secondaryText)
                            }
                            ForEach(file.rejections, id: \.self) { rejection in
                                Label(rejection, systemImage: "exclamationmark.triangle")
                                    .font(QuaiFont.caption)
                                    .foregroundStyle(Palette.wantedText)
                            }
                            if file.needsEpisodes {
                                Picker("Choose the episode", selection: Binding(
                                    get: { chosen[file.file] ?? 0 },
                                    set: { chosen[file.file] = $0 == 0 ? nil : $0 }
                                )) {
                                    Text("Choose the episode").tag(0)
                                    ForEach(preview.episodes, id: \.id) { episode in
                                        Text(episodeLabel(episode)).tag(episode.id)
                                    }
                                }
                                .pickerStyle(.menu)
                                .tint(Palette.accent)
                            }
                        }
                    }
                    Button {
                        confirming = true
                    } label: {
                        if importing { ProgressView().tint(Palette.onAccent) } else { Text("Import anyway") }
                    }
                    .buttonStyle(PillButtonStyle())
                    .disabled(!ready || importing)
                    .opacity(ready ? 1 : 0.5)
                } else if failure == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(Metrics.gutter)
        }
        .scrollIndicators(.hidden)
        .background(Palette.background.ignoresSafeArea())
        .task {
            do { preview = try await connection.importPreview(fix) } catch { failure = error.message(replacing: failure) }
        }
        .alert("Import anyway?", isPresented: $confirming) {
            Button("Import") { runImport() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(rejections.isEmpty ? "\(fix.serviceName) imports the files as shown." : "\(fix.serviceName) said:\n\(rejections)")
        }
    }

    private func episodeLabel(_ episode: Components.Schemas.EpisodeChoice) -> String {
        let code = String(format: "S%02dE%02d", episode.seasonNumber, episode.episodeNumber)
        guard let title = episode.title, !title.isEmpty else { return code }
        return "\(code) · \(title)"
    }

    private func runImport() {
        importing = true
        Task {
            do {
                try await connection.importDownload(fix, episodes: chosen)
                dismiss()
            } catch {
                failure = error.message(replacing: failure)
            }
            importing = false
        }
    }
}
