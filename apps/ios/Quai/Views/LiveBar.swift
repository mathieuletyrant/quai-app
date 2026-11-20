import SwiftUI

/// What the floating bar follows: playback first, then downloads, the furthest along first.
struct LiveNow {
    let items: [LiveItem]

    init(_ today: Today) {
        items = today.playing.map(LiveItem.playing) + today.downloading.map(LiveItem.downloading)
    }

    var isEmpty: Bool { items.isEmpty }

    var playing: [RunningActivity] { items.compactMap(\.playing) }
    var downloading: [RunningActivity] { items.compactMap(\.downloading) }
}

/// One thing going on right now, as the bar shows it.
enum LiveItem: Identifiable {
    case playing(RunningActivity)
    case downloading(RunningActivity)

    var activity: RunningActivity {
        switch self {
        case .playing(let activity), .downloading(let activity): activity
        }
    }

    var id: String { activity.attributes.key }

    var playing: RunningActivity? {
        guard case .playing(let activity) = self else { return nil }
        return activity
    }

    var downloading: RunningActivity? {
        guard case .downloading(let activity) = self else { return nil }
        return activity
    }

    /// The line under the title: "TV Salon", "12.4 MB/s · ≈ 4 min".
    var subtitle: String {
        let content = activity.content
        switch self {
        case .playing:
            return content.detail ?? activity.stepLabel
        case .downloading:
            var parts: [String] = []
            if let speed = content.bytesPerSecond, speed > 0 { parts.append(Format.speed(speed)) }
            if let remaining = content.remainingSeconds { parts.append(Format.remaining(remaining)) }
            if content.tone == .stalled { parts.append("stalled") }
            return parts.isEmpty ? activity.stepLabel : parts.joined(separator: " · ")
        }
    }

    var color: Color {
        switch self {
        case .playing: Palette.playback
        case .downloading: activity.content.tone == .stalled ? Palette.stalled : Palette.downloads
        }
    }
}

/// The bar above the tab bar while something plays or downloads, like Music's mini player:
/// one item at a time, swiped through, a tap opens them all.
struct LiveBar: View {
    let live: LiveNow
    let open: () -> Void
    @State private var index = 0
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    private var current: LiveItem? {
        live.items.isEmpty ? nil : live.items[min(index, live.items.count - 1)]
    }

    /// Which item of how many, when there are several.
    private var position: (index: Int, count: Int)? {
        let count = live.items.count
        guard count > 1 else { return nil }
        return (min(index, count - 1), count)
    }

    var body: some View {
        if let current {
            HStack(spacing: 12) {
                Button(action: open) {
                    LiveBarLabel(item: current, position: position, compact: placement == .inline)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows what's playing and downloading")
                LiveBarTrailing(item: current)
            }
            .padding(.horizontal, 14)
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 24).onEnded { drag in
                    let count = live.items.count
                    guard count > 1, abs(drag.translation.width) > abs(drag.translation.height) else { return }
                    let step = drag.translation.width < 0 ? 1 : -1
                    withAnimation(.snappy) { index = (min(index, count - 1) + step + count) % count }
                }
            )
        }
    }
}

private struct LiveBarLabel: View {
    let item: LiveItem
    /// Which item of how many, when there are several.
    let position: (index: Int, count: Int)?
    let compact: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: item.activity.attributes.icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(item.color)
                .frame(width: 30, height: 30)
                .background(item.color.opacity(0.18), in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(item.activity.attributes.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(1)
                if !compact {
                    Text(item.subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if let position, !compact {
                PageDots(index: position.index, count: position.count)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Play/Pause for playback, the percent for a download.
private struct LiveBarTrailing: View {
    let item: LiveItem

    var body: some View {
        switch item {
        case .playing(let activity):
            PlaybackButtons(activity: activity, only: [.playPause], size: 34)
        case .downloading(let activity):
            if let progress = activity.content.progress {
                Text(Format.percent(progress))
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(item.color)
            }
        }
    }
}

/// Small dots under the bar's items, the current one lit.
private struct PageDots: View {
    let index: Int
    let count: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<min(count, 5), id: \.self) { dot in
                Circle()
                    .fill(dot == index ? Palette.primaryText : Palette.tertiaryText)
                    .frame(width: 5, height: 5)
            }
        }
        .accessibilityLabel("\(index + 1) of \(count)")
    }
}

/// The step's playback buttons (Play/Pause, Stop), as on the Lock Screen.
struct PlaybackButtons: View {
    @Environment(Connection.self) private var connection
    let activity: RunningActivity
    var only: Set<ActivityAction>? = nil
    var size: CGFloat = 44

    private var actions: [ActivityAction] {
        let steps = activity.attributes.steps
        guard steps.indices.contains(activity.content.step) else { return [] }
        let all = (steps[activity.content.step].actions ?? []).compactMap { ActivityAction(rawValue: $0.rawValue) }
        return all.filter { $0 == .playPause || $0 == .stop }.filter { only?.contains($0) ?? true }
    }

    var body: some View {
        HStack(spacing: 12) {
            ForEach(actions, id: \.self) { action in
                Button {
                    Task { await connection.perform(action, on: activity) }
                } label: {
                    Image(systemName: action.symbol(paused: activity.content.paused == true))
                        .font(.system(size: size * 0.4, weight: .bold))
                        .foregroundStyle(action == .playPause ? Palette.onAccent : Palette.primaryText)
                        .frame(width: size, height: size)
                        .background(action == .playPause ? Palette.playback : Palette.raised, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(action.label)
            }
        }
    }
}

/// The bar opened: everything playing and downloading, with the playback buttons.
struct LiveSheet: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss

    private var live: LiveNow { LiveNow(Today(connection.activities, subjects: connection.flowSubjects)) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.tileSpacing) {
                    if live.isEmpty {
                        MessageTile(title: "Nothing live", message: "Nothing is playing or downloading right now.", systemImage: "moon.stars.fill", color: Palette.accent)
                    }
                    ForEach(live.playing, id: \.attributes.key) { activity in
                        PlayingCard(activity: activity)
                    }
                    ForEach(live.downloading, id: \.attributes.key) { activity in
                        ActivityRow(activity: activity)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("Live now")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                // Open while something moves: follow it closely.
                while !Task.isCancelled {
                    await connection.refresh()
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Palette.background)
    }
}

/// What's playing: the title, where, the timeline moving on its own, and the buttons.
private struct PlayingCard: View {
    let activity: RunningActivity

    private var playingLabel: String {
        activity.content.detail.map { "Playing · \($0)" } ?? "Playing"
    }

    var body: some View {
        Tile {
            TileLabel(title: activity.content.paused == true ? "Paused" : playingLabel, systemImage: activity.content.paused == true ? "pause.fill" : "play.fill", color: Palette.playback)
            Text(activity.attributes.title)
                .font(QuaiFont.headline)
                .foregroundStyle(Palette.primaryText)
            PlaybackProgress(content: activity.content)
            HStack {
                Spacer()
                PlaybackButtons(activity: activity, size: 52)
                Spacer()
            }
        }
    }
}

/// Where playback is: the bar fills on its own while it plays; elapsed and left under it.
struct PlaybackProgress: View {
    let content: Components.Schemas.ActivityContent

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let position = PlaybackPosition(content, at: context.date)
            VStack(spacing: 6) {
                ProgressBar(value: position.progress, color: Palette.playback)
                if let elapsed = position.elapsed, let left = position.left {
                    HStack {
                        Text(Format.clock(elapsed))
                        Spacer()
                        Text("-" + Format.clock(left))
                    }
                    .font(QuaiFont.caption.monospacedDigit())
                    .foregroundStyle(Palette.secondaryText)
                }
            }
        }
    }
}

/// Where a playback is at a moment, from the server's timeline (start and end dates) or, paused,
/// the position it stopped at.
struct PlaybackPosition: Equatable {
    let progress: Double
    let elapsed: TimeInterval?
    let left: TimeInterval?

    init(_ content: Components.Schemas.ActivityContent, at date: Date) {
        guard let start = content.startsAt, let end = content.endsAt, end > start else {
            progress = content.progress ?? 0
            elapsed = nil
            left = nil
            return
        }
        let length = end - start
        let running = (date.timeIntervalSince1970 - start) / length
        let value = min(max(content.paused == true ? (content.progress ?? running) : running, 0), 1)
        progress = value
        elapsed = value * length
        left = (1 - value) * length
    }
}
