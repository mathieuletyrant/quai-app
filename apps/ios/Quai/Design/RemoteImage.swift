import SwiftUI
import UIKit

/// Posters, loaded once and kept: decoded images in memory, their bytes in a disk cache.
///
/// Replaces `AsyncImage`, which forgets an image as soon as its cell scrolls away and, in a lazy
/// grid, often ends on a cancelled load it never retries: the poster stays a plain tile.
final class ImageStore: @unchecked Sendable {
    static let shared = ImageStore()

    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession

    init() {
        memory.countLimit = 400
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 256 << 20)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: configuration)
    }

    /// The image already in memory: shown on the first frame, without a placeholder.
    func cached(_ url: URL) -> UIImage? { memory.object(forKey: url as NSURL) }

    /// Loads, decodes off the main thread and keeps the image. Throws `CancellationError` when
    /// the view that asked went away: it asks again when it comes back.
    func image(for url: URL) async throws -> UIImage {
        if let image = cached(url) { return image }
        var lastError: Error = URLError(.unknown)
        // One retry: a dropped connection on the mobile network shouldn't leave a blank tile.
        for attempt in 0..<2 {
            try Task.checkCancellation()
            do {
                let (data, response) = try await session.data(from: url)
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    throw URLError(.badServerResponse)
                }
                guard let decoded = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
                let image = await decoded.byPreparingForDisplay() ?? decoded
                memory.setObject(image, forKey: url as NSURL)
                return image
            } catch let error as URLError where error.code == .cancelled {
                throw CancellationError()
            } catch {
                lastError = error
                if attempt == 0 { try await Task.sleep(for: .milliseconds(400)) }
            }
        }
        throw lastError
    }
}

/// What a `RemoteImage` shows: the image, while it loads, or when there is none.
enum RemoteImagePhase {
    case loading
    case loaded(Image)
    case unavailable
}

/// An image from a public URL, through `ImageStore`. A load cancelled because the view left is
/// started again when it comes back, never shown as a failure.
struct RemoteImage<Content: View>: View {
    let url: URL?
    @ViewBuilder var content: (RemoteImagePhase) -> Content
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
            .task(id: url) {
                guard let url, loaded?.url != url else { return }
                do {
                    let image = try await ImageStore.shared.image(for: url)
                    loaded = (url, image)
                } catch is CancellationError {
                    // The view left: it loads again if it comes back.
                } catch {
                    failed = url
                }
            }
    }
}
