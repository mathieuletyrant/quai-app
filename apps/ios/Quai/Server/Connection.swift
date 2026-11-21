import ActivityKit
import Foundation
import Observation
import OpenAPIRuntime
import OpenAPIURLSession

/// Why a call to Quai Cloud failed, in one message each. Refusals are read from the answer by
/// `QuaiErrorsMiddleware` only, never route by route.
enum ConnectionError: LocalizedError, Equatable {
    case unreachable
    /// A reverse proxy in front of Quai Cloud refused the request, not Quai.
    case blockedByProxy
    case invalidCode
    /// This iPhone's token is no longer valid: it was removed in the console.
    case removed
    case homeOffline
    case server(Int)
    /// The service (or Quai) refused, in its words.
    case refused(String)
    /// What it acted on went away first (a release came in, a request was decided elsewhere).
    case gone

    var errorDescription: String? {
        switch self {
        case .unreachable: "Can't reach the Quai server. On Wi-Fi at home, or check the address."
        case .blockedByProxy: "Blocked by your proxy: check the access headers in Settings → Connection."
        case .homeOffline: "Quai Home isn't connected to Quai Cloud. Check that it runs on your server."
        case .invalidCode: "This code is unknown, already used or expired. Show a new one in the console."
        case .removed: "This iPhone was removed from the console. Pair it again."
        case let .server(status): "The server answered \(status)."
        case let .refused(message): message
        case .gone: "This is already sorted out. Pull to refresh the list."
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
    /// The alerts going on, and the kinds turned on.
    private(set) var alerts: Components.Schemas.ActiveAlerts?
    /// The journal, newest first: the first page, then the older ones the Activity tab asked for.
    private(set) var journal: [Components.Schemas.JournalEntry] = []
    private(set) var journalHasMore = false
    private(set) var journalError: String?
    private var session: ServerSession?
    private var pendingPlayback = PendingPlayback()
    /// The search for an address that answers, while one runs.
    private var connecting: Task<(url: URL, client: Client), any Error>?
    /// Arrives from ActivityKit at any time, before or after pairing.
    private var pushToStartToken: String?

    var isPaired: Bool { session != nil }
    /// Every address this iPhone may reach the server at, the local one first.
    var serverURLs: [URL] { session?.urls ?? [] }
    /// Quai answers at its first address, the one at home (the pairing code lists it first). With
    /// a single address, the app can't tell: it counts as away.
    var isAtHome: Bool { serverURLs.count > 1 && serverURL == serverURLs.first }
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
        let middlewares: [any ClientMiddleware] = [QuaiErrorsMiddleware(), AccessHeadersMiddleware(headers: link.accessHeaders)]
        let client = Client(serverURL: url, transport: URLSessionTransport(), middlewares: middlewares)
        let body = Components.Schemas.PairDevice(
            code: link.code,
            name: name,
            apnsEnvironment: Self.apnsEnvironment,
            pushToStartToken: pushToStartToken,
            timeZone: TimeZone.current.identifier
        )
        let paired = try await client.pairDevice(body: .json(body)).ok.body.json
        let session = ServerSession(
            token: paired.token,
            urls: link.serverURLs.contains(url) ? link.serverURLs : [url] + link.serverURLs,
            accessHeaders: link.accessHeaders
        )
        session.save()
        self.session = session
        serverURL = url
        connecting = nil
        lastError = nil
        await refresh()
    }

    /// Typed in Settings → Connection, for a proxy set up after pairing. Saved in the Keychain.
    func setAccessHeaders(_ headers: [AccessHeader]) async {
        guard var session else { return }
        session.accessHeaders = headers
        session.save()
        self.session = session
        connecting = nil
        await refresh()
    }

    func disconnect() {
        ServerSession.clear()
        session = nil
        connecting = nil
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
        alerts = nil
        journal = []
        journalHasMore = false
        journalError = nil
    }

    // MARK: Preferences

    func preferences() async throws -> Components.Schemas.DevicePreferences {
        try await requiredClient().getPreferences().ok.body.json
    }

    func save(_ preferences: Components.Schemas.DevicePreferences) async throws {
        _ = try await requiredClient().savePreferences(body: .json(preferences)).ok
    }

    func flows() async throws -> [Components.Schemas.FlowSummary] {
        try await requiredClient().listFlows().ok.body.json
    }

    // MARK: Activities

    func refresh() async {
        guard session != nil else { return }
        do {
            let client = try await requiredClient()
            activities = pendingPlayback.apply(to: try await client.listActivities().ok.body.json)
            lastError = nil
            await learnSubjects()
        } catch {
            lastError = error.quaiMessage
        }
    }

    /// A Live Activity button pressed in the app: it shows at once, then the server confirms.
    func perform(_ action: ActivityAction, on activity: RunningActivity) async {
        if action == .playPause {
            pendingPlayback.toggle(activity)
            activities = pendingPlayback.apply(to: activities)
        }
        try? await RemoteControl.perform(key: activity.attributes.key, action: action)
        await refresh()
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
            library = try await requiredClient().getLibrary().ok.body.json
            libraryError = nil
        } catch {
            libraryError = error.quaiMessage
        }
    }

    // MARK: To fix

    func loadFixes() async {
        do {
            fixes = try await requiredClient().listFixes().ok.body.json
            fixesError = nil
        } catch {
            fixesError = error.quaiMessage
        }
    }

    /// Takes the download out of the queue and the download client; `blocklist` also bans the release.
    func removeDownload(_ fix: Components.Schemas.Fix, blocklist: Bool) async throws {
        _ = try await requiredClient().removeDownload(path: .init(id: fix.id), body: .json(.init(blocklist: blocklist))).noContent
        await didFix(fix)
    }

    /// What Import anyway would import: the files, why they were refused, the episodes to choose from.
    func importPreview(_ fix: Components.Schemas.Fix) async throws -> Components.Schemas.ImportPreview {
        try await requiredClient().previewImport(path: .init(id: fix.id)).ok.body.json
    }

    /// Imports the download's files as matched, or as the episodes chosen (file → episode ids).
    func importDownload(_ fix: Components.Schemas.Fix, episodes: [String: Int]) async throws {
        let assignments = episodes.map { Components.Schemas.EpisodeAssignment(file: $0.key, episodeIds: [$0.value]) }
        _ = try await requiredClient().importDownload(path: .init(id: fix.id), body: .json(.init(assignments: assignments))).noContent
        await didFix(fix)
    }

    /// Protects the title in Reclaimerr, or spares the download in Cleanuparr's queue cleaner, for good.
    func keep(_ fix: Components.Schemas.Fix) async throws {
        _ = try await requiredClient().keepTitle(path: .init(id: fix.id)).noContent
        await didFix(fix)
    }

    /// Lets the deletion or the removal happen: Quai stops showing it.
    func dismiss(_ fix: Components.Schemas.Fix) async throws {
        _ = try await requiredClient().dismissFix(path: .init(id: fix.id)).noContent
        await didFix(fix)
    }

    /// Hides the problem until a release is grabbed (`days` nil), or for some days.
    func snooze(_ fix: Components.Schemas.Fix, days: Int?) async throws {
        _ = try await requiredClient().snoozeFix(path: .init(id: fix.id), body: .json(.init(days: days))).noContent
        await didFix(fix)
    }

    /// The releases the indexers have for a title without a file. Can take up to a minute.
    func releases(_ fix: Components.Schemas.Fix) async throws -> [Components.Schemas.Release] {
        try await requiredClient().searchReleases(path: .init(id: fix.id)).ok.body.json.items
    }

    func grab(_ release: Components.Schemas.Release, for fix: Components.Schemas.Fix) async throws {
        _ = try await requiredClient().grabRelease(path: .init(id: fix.id), body: .json(.init(guid: release.guid, indexerId: release.indexerId))).noContent
        await didFix(fix)
    }

    // MARK: Releases

    func loadReleases() async {
        do {
            releases = try await requiredClient().getTodayReleases().ok.body.json
            releasesError = nil
        } catch {
            releasesError = error.quaiMessage
        }
    }

    // MARK: Alerts

    /// Read with the Home's other tiles; a failure keeps what was shown.
    func loadAlerts() async {
        if let read = try? await requiredClient().listAlerts().ok.body.json { alerts = read }
    }

    // MARK: Journal

    /// The newest page of the journal: what happened to the titles, the requests and the server.
    func loadJournal() async {
        do {
            let page = try await requiredClient().listJournal(query: .init(limit: "\(Self.journalPageSize)")).ok.body.json
            journal = page.entries
            journalHasMore = page.more
            journalError = nil
        } catch {
            journalError = error.quaiMessage
        }
    }

    /// The next page, older than what's loaded.
    func loadOlderJournal() async {
        guard journalHasMore, let oldest = journal.last else { return }
        do {
            let page = try await requiredClient().listJournal(query: .init(before: oldest.id, limit: "\(Self.journalPageSize)")).ok.body.json
            journal += page.entries
            journalHasMore = page.more
            journalError = nil
        } catch {
            journalError = error.quaiMessage
        }
    }

    private static let journalPageSize = 40

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
            requests = try await requiredClient().listRequests().ok.body.json
            requestsError = nil
        } catch {
            requestsError = error.quaiMessage
        }
    }

    /// Approves the request in Seerr: Radarr or Sonarr take it from there.
    func approve(_ request: Components.Schemas.MediaRequest) async throws {
        _ = try await requiredClient().approveRequest(path: .init(id: String(request.id))).noContent
        await didDecide(request)
    }

    func decline(_ request: Components.Schemas.MediaRequest) async throws {
        _ = try await requiredClient().declineRequest(path: .init(id: String(request.id))).noContent
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

    /// A client on the address that answers first. The calls made together (the app coming to the
    /// front starts several) share one search rather than each asking every address.
    private func requiredClient() async throws -> Client {
        guard let session else { throw ConnectionError.unreachable }
        let search = connecting ?? Task { try await session.connect() }
        connecting = search
        defer { if connecting == search { connecting = nil } }
        let (url, client) = try await search.value
        serverURL = url
        return client
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

    /// The notification token for alerts, each time APNs gives one.
    func watchNotificationTokens() async {
        for await hex in AppDelegate.tokens.stream {
            await send { client in
                _ = try await client.updateDevice(body: .json(.init(notificationToken: hex)))
            }
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
