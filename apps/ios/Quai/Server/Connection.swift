import ActivityKit
import Foundation
import Observation
import OpenAPIRuntime
import OpenAPIURLSession

enum ConnectionError: LocalizedError {
    case unreachable
    /// A reverse proxy in front of Quai Cloud refused the request, not Quai.
    case blockedByProxy
    case invalidCode
    case homeOffline
    case server(Int)
    /// The service (or Quai) refused a fix, in its words.
    case refused(String)
    /// The problem went away before the fix ran (a release came in, the title was deleted).
    case fixGone

    var errorDescription: String? {
        switch self {
        case .unreachable: "Can't reach the Quai server. On Wi-Fi at home, or check the address."
        case .blockedByProxy: "Blocked by your proxy: check the access headers in Settings → Connection."
        case .homeOffline: "Quai Home isn't connected to Quai Cloud. Check that it runs on your server."
        case .invalidCode: "This code is unknown, already used or expired. Show a new one in the console."
        case let .server(status): "The server answered \(status)."
        case let .refused(message): message
        case .fixGone: "This is already sorted out. Pull to refresh the list."
        }
    }
}

/// The link between this iPhone and its Quai server: pairing, tokens, and the running activities.
@MainActor @Observable
final class Connection {
    private(set) var serverURL: URL?
    private(set) var activities: [Components.Schemas.RunningActivity] = []
    /// What each flow's activities follow, by flow id: the Home groups activities by it.
    private(set) var flowSubjects: [String: Components.Schemas.FlowSubject] = [:]
    /// The last error of the activities' refresh (the Home and Activity tabs show it).
    private(set) var lastError: String?
    /// The home's movies and series, once loaded.
    private(set) var library: Components.Schemas.Library?
    private(set) var libraryError: String?
    /// The To fix list, once loaded.
    private(set) var fixes: Components.Schemas.Fixes?
    private(set) var fixesError: String?
    /// Seerr's requests waiting for approval, once loaded.
    private(set) var requests: Components.Schemas.MediaRequests?
    private(set) var requestsError: String?
    /// Today's releases, once loaded.
    private(set) var releases: Components.Schemas.DayReleases?
    private(set) var releasesError: String?
    private var session: ServerSession?
    /// Arrives from ActivityKit at any time, before or after pairing.
    private var pushToStartToken: String?

    var isPaired: Bool { session != nil }
    /// Every address this iPhone may reach the server at, the local one first.
    var serverURLs: [URL] { session?.urls ?? [] }
    /// What the proxy in front of the public address requires.
    var accessHeaders: [AccessHeader] { session?.accessHeaders ?? [] }

    /// Builds from Xcode reach APNs development; TestFlight and the App Store, production.
    static var apnsEnvironment: Components.Schemas.ApnsEnvironment {
        #if DEBUG
            .development
        #else
            .production
        #endif
    }

    init() {
        session = ServerSession.stored()
        serverURL = session?.urls.first
    }

    // MARK: Pairing

    func pair(_ link: PairingLink, name: String) async throws {
        let url = try await ServerSession.firstReachable(link.serverURLs, accessHeaders: link.accessHeaders)
        let client = Client(serverURL: url, transport: URLSessionTransport(), middlewares: [AccessHeadersMiddleware(headers: link.accessHeaders)])
        let body = Components.Schemas.PairDevice(
            code: link.code,
            name: name,
            apnsEnvironment: Self.apnsEnvironment,
            pushToStartToken: pushToStartToken,
            timeZone: TimeZone.current.identifier
        )
        switch try await client.pairDevice(body: .json(body)) {
        case let .ok(ok):
            let paired = try ok.body.json
            let session = ServerSession(
                token: paired.token,
                urls: [url] + link.serverURLs.filter { $0 != url },
                accessHeaders: link.accessHeaders
            )
            session.save()
            self.session = session
            serverURL = url
            lastError = nil
            await refresh()
        case .forbidden:
            throw ConnectionError.invalidCode
        case .serviceUnavailable:
            throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _):
            throw ConnectionError.server(statusCode)
        }
    }

    /// Typed in Settings → Connection, for a proxy set up after pairing. Saved in the Keychain.
    func setAccessHeaders(_ headers: [AccessHeader]) async {
        guard var session else { return }
        session.accessHeaders = headers
        session.save()
        self.session = session
        await refresh()
    }

    func disconnect() {
        ServerSession.clear()
        session = nil
        serverURL = nil
        activities = []
        flowSubjects = [:]
        library = nil
        libraryError = nil
        fixes = nil
        fixesError = nil
        requests = nil
        requestsError = nil
        releases = nil
        releasesError = nil
    }

    // MARK: Preferences

    func preferences() async throws -> Components.Schemas.DevicePreferences {
        let client = try await requiredClient()
        switch try await client.getPreferences() {
        case let .ok(ok): return try ok.body.json
        case .unauthorized: throw ConnectionError.server(401)
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    func save(_ preferences: Components.Schemas.DevicePreferences) async throws {
        let client = try await requiredClient()
        switch try await client.savePreferences(body: .json(preferences)) {
        case .ok: return
        case .unauthorized: throw ConnectionError.server(401)
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    func flows() async throws -> [Components.Schemas.FlowSummary] {
        let client = try await requiredClient()
        switch try await client.listFlows() {
        case let .ok(ok): return try ok.body.json
        case .unauthorized: throw ConnectionError.server(401)
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    // MARK: Activities

    func refresh() async {
        guard let client = await authenticatedClient() else { return }
        do {
            switch try await client.listActivities() {
            case let .ok(ok):
                activities = try ok.body.json
                lastError = nil
                await learnSubjects()
            case .unauthorized:
                lastError = "This iPhone was removed from the console. Pair it again."
            case .serviceUnavailable:
                lastError = ConnectionError.homeOffline.localizedDescription
            case let .undocumented(statusCode, _):
                lastError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            lastError = error.quaiMessage
        }
    }

    /// A flow seen for the first time (a new custom one, or the first refresh): learn what it follows.
    private func learnSubjects() async {
        guard activities.contains(where: { flowSubjects[$0.attributes.flowId] == nil }),
              let all = try? await flows()
        else { return }
        flowSubjects = Dictionary(all.map { ($0.id, $0.subject) }, uniquingKeysWith: { first, _ in first })
    }

    // MARK: Library

    func loadLibrary() async {
        do {
            let client = try await requiredClient()
            switch try await client.getLibrary() {
            case let .ok(ok):
                library = try ok.body.json
                libraryError = nil
            case .unauthorized:
                libraryError = "This iPhone was removed from the console. Pair it again."
            case .serviceUnavailable:
                libraryError = ConnectionError.homeOffline.localizedDescription
            case let .undocumented(statusCode, _):
                libraryError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            libraryError = error.quaiMessage
        }
    }

    // MARK: To fix

    func loadFixes() async {
        do {
            let client = try await requiredClient()
            switch try await client.listFixes() {
            case let .ok(ok):
                fixes = try ok.body.json
                fixesError = nil
            case .unauthorized:
                fixesError = "This iPhone was removed from the console. Pair it again."
            case .serviceUnavailable:
                fixesError = ConnectionError.homeOffline.localizedDescription
            case let .undocumented(statusCode, _):
                fixesError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            fixesError = error.quaiMessage
        }
    }

    /// Takes the download out of the queue and the download client; `blocklist` also bans the release.
    func removeDownload(_ fix: Components.Schemas.Fix, blocklist: Bool) async throws {
        let client = try await requiredClient()
        switch try await client.removeDownload(path: .init(id: fix.id), body: .json(.init(blocklist: blocklist))) {
        case .noContent: break
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didFix(fix)
    }

    /// What Import anyway would import: the files, why they were refused, the episodes to choose from.
    func importPreview(_ fix: Components.Schemas.Fix) async throws -> Components.Schemas.ImportPreview {
        let client = try await requiredClient()
        switch try await client.previewImport(path: .init(id: fix.id)) {
        case let .ok(ok): return try ok.body.json
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    /// Imports the download's files as matched, or as the episodes chosen (file → episode ids).
    func importDownload(_ fix: Components.Schemas.Fix, episodes: [String: Int]) async throws {
        let client = try await requiredClient()
        let assignments = episodes.map { Components.Schemas.EpisodeAssignment(file: $0.key, episodeIds: [$0.value]) }
        switch try await client.importDownload(path: .init(id: fix.id), body: .json(.init(assignments: assignments))) {
        case .noContent: break
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didFix(fix)
    }

    /// Protects the title in Reclaimerr, for good.
    func keep(_ fix: Components.Schemas.Fix) async throws {
        let client = try await requiredClient()
        switch try await client.keepTitle(path: .init(id: fix.id)) {
        case .noContent: break
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didFix(fix)
    }

    /// Lets the deletion happen: Quai stops showing it.
    func dismiss(_ fix: Components.Schemas.Fix) async throws {
        let client = try await requiredClient()
        switch try await client.dismissFix(path: .init(id: fix.id)) {
        case .noContent: break
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didFix(fix)
    }

    /// Hides the problem until a release is grabbed (`days` nil), or for some days.
    func snooze(_ fix: Components.Schemas.Fix, days: Int?) async throws {
        let client = try await requiredClient()
        switch try await client.snoozeFix(path: .init(id: fix.id), body: .json(.init(days: days))) {
        case .noContent: break
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didFix(fix)
    }

    /// The releases the indexers have for a title without a file. Can take up to a minute.
    func releases(_ fix: Components.Schemas.Fix) async throws -> [Components.Schemas.Release] {
        let client = try await requiredClient()
        switch try await client.searchReleases(path: .init(id: fix.id)) {
        case let .ok(ok): return try ok.body.json.items
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    func grab(_ release: Components.Schemas.Release, for fix: Components.Schemas.Fix) async throws {
        let client = try await requiredClient()
        switch try await client.grabRelease(path: .init(id: fix.id), body: .json(.init(guid: release.guid, indexerId: release.indexerId))) {
        case .noContent: break
        case let .badRequest(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Not possible")
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "The service refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didFix(fix)
    }

    // MARK: Releases

    func loadReleases() async {
        do {
            let client = try await requiredClient()
            switch try await client.getTodayReleases() {
            case let .ok(ok):
                releases = try ok.body.json
                releasesError = nil
            case .unauthorized:
                releasesError = "This iPhone was removed from the console. Pair it again."
            case .serviceUnavailable:
                releasesError = ConnectionError.homeOffline.localizedDescription
            case let .undocumented(statusCode, _):
                releasesError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            releasesError = error.quaiMessage
        }
    }

    /// The home's evening follows the iPhones' time zone: told when the app comes to the front.
    func reportTimeZone() async {
        let zone = TimeZone.current.identifier
        await send { client in
            _ = try await client.updateDevice(body: .json(.init(timeZone: zone)))
        }
    }

    // MARK: Requests

    func loadRequests() async {
        do {
            let client = try await requiredClient()
            switch try await client.listRequests() {
            case let .ok(ok):
                requests = try ok.body.json
                requestsError = nil
            case .unauthorized:
                requestsError = "This iPhone was removed from the console. Pair it again."
            case .serviceUnavailable:
                requestsError = ConnectionError.homeOffline.localizedDescription
            case let .undocumented(statusCode, _):
                requestsError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            requestsError = error.quaiMessage
        }
    }

    /// Approves the request in Seerr: Radarr or Sonarr take it from there.
    func approve(_ request: Components.Schemas.MediaRequest) async throws {
        let client = try await requiredClient()
        switch try await client.approveRequest(path: .init(id: String(request.id))) {
        case .noContent: break
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Seerr refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didDecide(request)
    }

    func decline(_ request: Components.Schemas.MediaRequest) async throws {
        let client = try await requiredClient()
        switch try await client.declineRequest(path: .init(id: String(request.id))) {
        case .noContent: break
        case .unauthorized: throw ConnectionError.server(401)
        case .notFound: throw ConnectionError.fixGone
        case let .badGateway(response): throw ConnectionError.refused((try? response.body.json)?.message ?? "Seerr refused")
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
        await didDecide(request)
    }

    /// Drops the decided request at once, then reads the list again.
    private func didDecide(_ request: Components.Schemas.MediaRequest) async {
        if let current = requests {
            requests = .init(items: current.items.filter { $0.id != request.id }, status: current.status)
        }
        await loadRequests()
    }

    /// Drops the fixed problem at once, then reads the list again.
    private func didFix(_ fix: Components.Schemas.Fix) async {
        if let current = fixes {
            fixes = .init(items: current.items.filter { $0.id != fix.id }, hidden: current.hidden, unavailable: current.unavailable)
        }
        await loadFixes()
    }

    /// Prefers the address that answered last; on another network, tries the others.
    private func requiredClient() async throws -> Client {
        guard let session else { throw ConnectionError.unreachable }
        do {
            let (url, client) = try await session.connect(preferring: serverURL)
            serverURL = url
            return client
        } catch {
            lastError = error.quaiMessage
            throw error
        }
    }

    /// The token that lets the server start a Live Activity on this iPhone. Runs as long as the app does.
    func watchPushToStartTokens() async {
        for await data in Activity<QuaiActivityAttributes>.pushToStartTokenUpdates {
            await didReceivePushToStartToken(data.hexString)
        }
    }

    /// The push token of every Quai activity, including the ones the server started remotely.
    func watchActivities() async {
        for activity in Activity<QuaiActivityAttributes>.activities {
            watch(activity)
        }
        for await activity in Activity<QuaiActivityAttributes>.activityUpdates {
            watch(activity)
        }
    }

    private func didReceivePushToStartToken(_ hex: String) async {
        pushToStartToken = hex
        await send { client in
            _ = try await client.updateDevice(body: .json(.init(pushToStartToken: hex)))
        }
    }

    /// Tells the server which activities are still on screen, so it shows again, at their next
    /// change, the ones the user swiped away.
    func reportShownActivities() async {
        let keys = Activity<QuaiActivityAttributes>.activities
            .filter { $0.activityState == .active || $0.activityState == .stale }
            .map(\.attributes.key)
        await send { client in
            _ = try await client.reportShownActivities(body: .json(.init(keys: keys)))
        }
    }

    private func watch(_ activity: Activity<QuaiActivityAttributes>) {
        Task { await reportTokens(of: activity) }
        Task { await reportWhenGone(activity) }
    }

    private func reportTokens(of activity: Activity<QuaiActivityAttributes>) async {
        let mediaKey = activity.attributes.key
        for await data in activity.pushTokenUpdates {
            let hex = data.hexString
            await send { client in
                _ = try await client.reportActivityToken(body: .json(.init(mediaKey: mediaKey, pushToken: hex)))
            }
        }
    }

    /// Swiped away (or ended) while the app runs: report it at once.
    private func reportWhenGone(_ activity: Activity<QuaiActivityAttributes>) async {
        for await state in activity.activityStateUpdates where state == .dismissed || state == .ended {
            await reportShownActivities()
            return
        }
    }

    // MARK: Plumbing

    private func send(_ call: (Client) async throws -> Void) async {
        guard let client = await authenticatedClient() else { return }
        do { try await call(client) } catch { lastError = error.quaiMessage }
    }

    /// `requiredClient`, for the calls that have nowhere to report a failure but `lastError`.
    private func authenticatedClient() async -> Client? {
        guard session != nil else { return nil }
        return try? await requiredClient()
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
