import CryptoKit
import SwiftUI
import UIKit

/// Posters kept on the phone across launches, in Application Support (not backed up). A poster's
/// URL names one image: TMDB and TheTVDB give a new path when a poster changes, so a kept one is
/// never stale and is never asked again. The least recently shown go past `limit` bytes.
struct PosterDisk: Sendable {
    let directory: URL
    var limit = 200 << 20

    static let shared = PosterDisk(
        directory: URL.applicationSupportDirectory.appending(path: "Posters", directoryHint: .isDirectory)
    )

    /// The poster's bytes, if kept; marks it as just shown.
    func data(for url: URL) -> Data? {
        let file = file(for: url)
        guard let data = try? Data(contentsOf: file) else { return nil }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
        return data
    }

    func store(_ data: Data, for url: URL) {
        let manager = FileManager.default
        if !manager.fileExists(atPath: directory.path) {
            try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
            var excluded = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? excluded.setResourceValues(values)
        }
        try? data.write(to: file(for: url), options: .atomic)
    }

    /// Removes the least recently shown posters until those kept fit in `limit`.
    func prune() {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys)) ?? []
        let kept = files.compactMap { file -> KeptPoster? in
            guard let values = try? file.resourceValues(forKeys: Set(keys)) else { return nil }
            return KeptPoster(file: file, shown: values.contentModificationDate ?? .distantPast, size: values.fileSize ?? 0)
        }
        var total = kept.reduce(0) { $0 + $1.size }
        for poster in kept.sorted(by: { $0.shown < $1.shown }) where total > limit {
            try? FileManager.default.removeItem(at: poster.file)
            total -= poster.size
        }
    }

    /// A poster's file, when it was last shown, and its size.
    private struct KeptPoster {
        let file: URL
        let shown: Date
        let size: Int
    }

    private func file(for url: URL) -> URL {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        return directory.appending(path: digest.map { String(format: "%02x", $0) }.joined())
    }
}

/// Posters, loaded once and kept: decoded images in memory, their bytes on disk (`PosterDisk`).
///
/// Replaces `AsyncImage`, which forgets an image as soon as its cell scrolls away and, in a lazy
/// grid, often ends on a cancelled load it never retries: the poster stays a plain tile.
final class ImageStore: @unchecked Sendable {
    static let shared = ImageStore(disk: .shared)

    private let memory = NSCache<NSURL, UIImage>()
    private let disk: PosterDisk
    private let session: URLSession

    init(disk: PosterDisk) {
        self.disk = disk
        memory.countLimit = 400
        let configuration = URLSessionConfiguration.default
        // The disk keeps the posters: an HTTP cache would keep them twice.
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: configuration)
        Task.detached(priority: .utility) { disk.prune() }
    }

    /// The image already in memory: shown on the first frame, without a placeholder.
    func cached(_ url: URL) -> UIImage? { memory.object(forKey: url as NSURL) }

    /// The image from memory, else the disk, else the network; decoded off the main thread and
    /// kept. Throws `CancellationError` when the view that asked went away: it asks again when it
    /// comes back.
    func image(for url: URL) async throws -> UIImage {
        if let image = cached(url) { return image }
        if let data = disk.data(for: url), let image = await decode(data) {
            memory.setObject(image, forKey: url as NSURL)
            return image
        }
        do {
            let (data, response) = try await session.data(from: url)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw URLError(.badServerResponse)
            }
            guard let image = await decode(data) else { throw URLError(.cannotDecodeContentData) }
            disk.store(data, for: url)
            memory.setObject(image, forKey: url as NSURL)
            return image
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        }
    }

    private func decode(_ data: Data) async -> UIImage? {
        guard let decoded = UIImage(data: data) else { return nil }
        return await decoded.byPreparingForDisplay() ?? decoded
    }

    /// The waits between a poster's tries while its view is on screen; the last one repeats.
    static let retryDelays: [Duration] = [.milliseconds(400), .seconds(2), .seconds(5), .seconds(15), .seconds(30)]

    /// Tries `attempt` until it answers or the task is cancelled, waiting `delays` between tries
    /// (the last one repeats) and calling `failed` after each failure. A phone back from the
    /// background, or out of a tunnel, loses its loads in flight: a poster that failed once must
    /// load again on its own, not stay a plain tile until its view is made again.
    @MainActor static func keepTrying<Value>(
        after delays: [Duration],
        _ attempt: () async throws -> Value,
        failed: () -> Void = {}
    ) async throws -> Value {
        var tries = 0
        while true {
            try Task.checkCancellation()
            do {
                return try await attempt()
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                failed()
                let delay = delays.isEmpty ? .zero : delays[min(tries, delays.count - 1)]
                tries += 1
                try await Task.sleep(for: delay)
            }
        }
    }
}

/// What a `RemoteImage` shows: the image, while it loads, or when there is none.
enum RemoteImagePhase {
    case loading
    case loaded(Image)
    case unavailable
}

/// An image from a public URL, through `ImageStore`. A load cancelled because the view left is
/// started again when it comes back, never shown as a failure; a failed one is tried again while
/// the view is on screen, and at once when the app comes back to the foreground.
struct RemoteImage<Content: View>: View {
    let url: URL?
    @ViewBuilder var content: (RemoteImagePhase) -> Content
    @Environment(\.scenePhase) private var scenePhase
    @State private var loaded: (url: URL, image: UIImage)?
    @State private var failed: URL?

    init(url: URL?, @ViewBuilder content: @escaping (RemoteImagePhase) -> Content) {
        self.url = url
        self.content = content
        // A poster seen before is there on the first frame: no placeholder flash on scroll back.
        if let url, let image = ImageStore.shared.cached(url) {
            _loaded = State(initialValue: (url, image))
        }
    }

    private var phase: RemoteImagePhase {
        guard let url else { return .unavailable }
        if let loaded, loaded.url == url { return .loaded(Image(uiImage: loaded.image)) }
        if let cached = ImageStore.shared.cached(url) { return .loaded(Image(uiImage: cached)) }
        return failed == url ? .unavailable : .loading
    }

    var body: some View {
        content(phase)
            .task(id: Load(url: url, active: scenePhase == .active)) {
                guard let url, loaded?.url != url else { return }
                do {
                    let image = try await ImageStore.keepTrying(after: ImageStore.retryDelays) {
                        try await ImageStore.shared.image(for: url)
                    } failed: {
                        failed = url
                    }
                    loaded = (url, image)
                } catch {
                    // Cancelled: the view left, or the app went to the background. It loads again
                    // when it comes back.
                }
            }
    }

    /// What starts a load again: another URL, or the app back in the foreground.
    private struct Load: Hashable {
        let url: URL?
        let active: Bool
    }
}
