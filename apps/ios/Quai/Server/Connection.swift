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
        case .unreachable: "Can't reach the Quai server. Check this iPhone's connection, then try again."
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

/// Where the link to the server stands.
enum ServerStatus: Equatable {
    /// Nothing has answered yet since launch or pairing.
    case connecting
    case connected
    /// The last refresh failed: `Connection.lastError` says why.
    case unreachable

    var label: String {
        switch self {
        case .connecting: "Connecting"
        case .connected: "Connected"
        case .unreachable: "Not reachable"
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
    private(set) var fixes: Components.Schemas.Fixes?
    private(set) var fixesError: String?
    /// Seerr's requests waiting for approval, once loaded.
    private(set) var requests: Components.Schemas.MediaRequests?
    private(set) var requestsError: String?
    /// What's coming and going, once loaded.
    private(set) var upcoming: Components.Schemas.Upcoming?
    private(set) var upcomingError: String?
    /// The media disks over the Storage screen's period, once loaded.
    private(set) var storage: Components.Schemas.Storage?
    private(set) var storageError: String?
    /// The Home's tiles as this iPhone ordered and hid them; the app's order until its preferences are read.
    private(set) var homeLayout = HomeLayout.standard
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
    /// Reads waiting to try again: still looking for the server.
    private var retries = 0
    /// Arrives from ActivityKit at any time, before or after pairing.
    private var pushToStartToken: String?

    /// How long every read waits before going out (DEBUG only), so the screenshot tests can
    /// photograph the loading states.
    @ObservationIgnored var readDelay: Duration?

    var isPaired: Bool { session != nil }
    /// A refresh of the activities has reached the server since pairing or launch.
    private var hasAnswered = false
    /// Where the link to the server stands: what Settings says and the Home's title shows.
    var status: ServerStatus {
        if lastError != nil { return .unreachable }
        if hasAnswered { return .connected }
        return .connecting
    }
    /// Looking for an address that answers, or about to try again.
    var isSearching: Bool { connecting != nil || retries > 0 }
    /// Every address this iPhone may reach the server at, the local one first.
    var serverURLs: [URL] { session?.urls ?? [] }
    /// Quai Home's console addresses, as the pairing code gave them: Quai Cloud serves none.
    var consoleURLs: [URL] { session?.consoleURLs ?? [] }

    /// The console address that works from where the iPhone is now.
    func consoleToOpen() async -> URL? {
        await ServerSession.consoleToOpen(consoleURLs) { await ServerSession.answers($0) }
    }
    /// Quai answers at its first address, the one at home (the pairing code lists it first). With
    /// a single address, the app can't tell: it counts as away.
    var isAtHome: Bool { ServerSession.isAtHome(serverURL, in: serverURLs) }
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
        // A key of this pairing's own: the home will answer only what it signs.
        let deviceKey = DeviceKey()
        let body = Components.Schemas.PairDevice(
            code: link.code,
            name: name,
            apnsEnvironment: Self.apnsEnvironment,
            pushToStartToken: pushToStartToken,
            timeZone: TimeZone.current.identifier,
            deviceKey: deviceKey.publicKey
        )
        let paired = try await client.pairDevice(body: .json(body)).ok.body.json
        let session = ServerSession(
            token: paired.token,
            urls: ServerSession.pairedURLs(link.serverURLs, answered: url),
            accessHeaders: link.accessHeaders,
            consoleURLs: link.consoleURLs,
            deviceKey: deviceKey
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
        hasAnswered = false
        activities = []
        flowSubjects = [:]
        library = nil
        libraryError = nil
        fixes = nil
        fixesError = nil
        requests = nil
        requestsError = nil
        upcoming = nil
        upcomingError = nil
        storage = nil
        storageError = nil
        alerts = nil
        homeLayout = .standard
        journal = []
        journalHasMore = false
        journalError = nil
    }

    // MARK: Preferences

    func preferences() async throws -> Components.Schemas.DevicePreferences {
        try await reading { try await $0.getPreferences().ok.body.json }
    }

    func save(_ preferences: Components.Schemas.DevicePreferences) async throws {
        // The Home follows at once; a failed save is said where it was made.
        homeLayout = HomeLayout(preferences.homeTiles)
        _ = try await requiredClient().savePreferences(body: .json(preferences)).ok
    }

    /// The Home's tiles from this iPhone's preferences; a failure keeps what was shown.
    func loadHomeLayout() async {
        if let read = try? await preferences() { homeLayout = HomeLayout(read.homeTiles) }
    }

    func flows() async throws -> [Components.Schemas.FlowSummary] {
        try await reading { try await $0.listFlows().ok.body.json }
    }

    // MARK: Activities

    func refresh() async {
        guard session != nil else { return }
        do {
            try await readActivities()
        } catch {
            lastError = error.message(replacing: lastError)
        }
    }

    private func readActivities() async throws {
        let read = try await pendingPlayback.apply(to: reading { try await $0.listActivities().ok.body.json })
        let shown = await Self.shown(read, known: flowSubjects) { try? await self.flows() }
        flowSubjects = shown.subjects
        activities = shown.activities
        lastError = nil
        hasAnswered = true
    }

    /// The app is back in front: a search started before it was suspended has had its requests
    /// frozen past their timeout, so the next call starts a new one.
    func didBecomeActive() {
        connecting = nil
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

    /// The activities read, with what their flows follow: both set together, so none shows before
    /// its flow's subject is known.
    static func shown(
        _ activities: [RunningActivity],
        known: [String: Components.Schemas.FlowSubject],
        load: () async -> [Components.Schemas.FlowSummary]?
    ) async -> (activities: [RunningActivity], subjects: [String: Components.Schemas.FlowSubject]) {
        await (activities, subjects(for: activities, known: known, load: load))
    }

    /// What each flow follows, by flow id: read again when an activity's flow is new (a new custom
    /// one, or the first refresh). A failed read keeps what was known.
    static func subjects(
        for activities: [RunningActivity],
        known: [String: Components.Schemas.FlowSubject],
        load: () async -> [Components.Schemas.FlowSummary]?
    ) async -> [String: Components.Schemas.FlowSubject] {
        guard activities.contains(where: { known[$0.attributes.flowId] == nil }), let all = await load() else { return known }
        return Dictionary(all.map { ($0.id, $0.subject) }, uniquingKeysWith: { first, _ in first })
    }

    // MARK: Tabs

    /// Reads again what a tab shows, each time it opens and each time the app comes back to the
    /// front on it: a status changed elsewhere shows without pulling. The reads run together.
    func reload(_ tab: AppTab) async {
        guard session != nil else { return }
        await withDiscardingTaskGroup { group in
            for read in tab.reads {
                group.addTask { await self.load(read) }
            }
        }
    }

    private func load(_ read: TabRead) async {
        switch read {
        case .fixes: await loadFixes()
        case .homeTiles: await loadHomeLayout()
        case .requests: await loadRequests()
        case .upcoming: await loadUpcoming()
        case .library: await loadLibrary()
        case .journal: await loadJournal()
        }
    }

    /// A read that hasn't answered yet: no value, no failure of its own, and the server not out of
    /// reach (that is an answer too: the dot says it), so its screen still shows it loading.
    func awaits(_ value: Any?, failure: String?) -> Bool {
        Self.awaits(hasValue: value != nil, failure: failure, serverError: lastError)
    }

    static func awaits(hasValue: Bool, failure: String?, serverError: String?) -> Bool {
        !hasValue && failure == nil && serverError == nil
    }

    // MARK: Library

    func loadLibrary() async {
        await read(\.library, failure: \.libraryError) { try await $0.getLibrary().ok.body.json }
    }

    // MARK: To fix

    func loadFixes() async {
        await read(\.fixes, failure: \.fixesError) { try await $0.listFixes().ok.body.json }
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
    func letGo(_ fix: Components.Schemas.Fix) async throws {
        _ = try await requiredClient().letGoFix(path: .init(id: fix.id)).noContent
        await didFix(fix)
    }

    /// Hides the fix until a release is grabbed (`days` nil), or for some days.
    func ignoreAndWait(_ fix: Components.Schemas.Fix, days: Int?) async throws {
        _ = try await requiredClient().ignoreAndWaitFix(path: .init(id: fix.id), body: .json(.init(days: days))).noContent
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

    // MARK: Upcoming

    func loadUpcoming() async {
        await read(\.upcoming, failure: \.upcomingError) { try await $0.getUpcoming().ok.body.json }
    }

    // MARK: Storage

    /// The Storage screen's disks over a period: shown until the next period's answer replaces them.
    func loadStorage(_ period: StoragePeriod) async {
        await read(\.storage, failure: \.storageError) { try await $0.getStorage(query: .init(period: period.api)).ok.body.json }
    }

    /// The disks over a period, without touching what the Storage screen shows (its All marks).
    func storage(_ period: StoragePeriod) async throws -> Components.Schemas.Storage {
        try await reading { try await $0.getStorage(query: .init(period: period.api)).ok.body.json }
    }

    // MARK: Alerts

    /// Read with the Home's other tiles; a failure keeps what was shown.
    func loadAlerts() async {
        if let read = try? await requiredClient().listAlerts().ok.body.json { alerts = read }
    }

    /// Whether Quai Home reaches this service, as the alerts say; unknown (not read yet, an older
    /// Cloud): yes, so nothing hides by mistake.
    func reaches(_ service: Components.Schemas.Service) -> Bool {
        alerts?.services?.contains(service) ?? true
    }

    // MARK: Journal

    /// The newest page of the journal: what happened to the titles, the requests and the server.
    func loadJournal() async {
        do {
            let page = try await reading { try await $0.listJournal(query: .init(limit: "\(Self.journalPageSize)")).ok.body.json }
            journal = page.entries
            journalHasMore = page.more
            journalError = nil
        } catch {
            didFail(error, \.journalError)
        }
    }

    func loadOlderJournal() async {
        guard journalHasMore, let oldest = journal.last else { return }
        do {
            let page = try await reading { try await $0.listJournal(query: .init(before: oldest.id, limit: "\(Self.journalPageSize)")).ok.body.json }
            journal += page.entries
            journalHasMore = page.more
            journalError = nil
        } catch {
            didFail(error, \.journalError)
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
        await read(\.requests, failure: \.requestsError) { try await $0.listRequests().ok.body.json }
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

    // MARK: Search

    /// The movies and series Seerr finds for this text.
    func search(_ query: String) async throws -> Components.Schemas.SearchResults {
        try await reading { try await $0.searchTitles(query: .init(query: query)).ok.body.json }
    }

    /// A series' seasons, and where each stands, for the season picker.
    func seasons(of result: Components.Schemas.SearchResult) async throws -> [Components.Schemas.SeasonChoice] {
        try await reading { try await $0.listSeasons(path: .init(tmdbId: String(result.tmdbId))).ok.body.json }.seasons
    }

    /// Requests a movie, or these seasons of a series, as the Seerr user chosen in Settings.
    func request(_ result: Components.Schemas.SearchResult, seasons: [Int] = []) async throws -> Components.Schemas.RequestCreated {
        let body = Components.Schemas.CreateRequest(kind: result.kind, tmdbId: result.tmdbId, seasons: result.kind == .series ? seasons : nil)
        let created = try await requiredClient().createRequest(body: .json(body)).ok.body.json
        // A request left waiting shows on the Home's Requests tile.
        if created.status == .pending { await loadRequests() }
        return created
    }

    /// Seerr's users, for Settings → Request as.
    func seerrUsers() async throws -> Components.Schemas.SeerrUsers {
        try await reading { try await $0.listSeerrUsers().ok.body.json }
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
        #if DEBUG
        if let readDelay { try await Task.sleep(for: readDelay) }
        #endif
        // swiftlint:disable:next unhandled_throwing_task - its error is thrown by `search.value` below
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

    /// Every Quai activity, including the ones the server started remotely, to report it once
    /// swiped away. Their tokens are `ActivityTokens`'.
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
        Task { await reportWhenGone(activity) }
    }

    /// Swiped away (or ended) while the app runs: report it at once.
    private func reportWhenGone(_ activity: Activity<QuaiActivityAttributes>) async {
        for await state in activity.activityStateUpdates where state == .dismissed || state == .ended {
            await reportShownActivities()
            return
        }
    }

    // MARK: Plumbing

    /// Every screen's read follows one rule: what it read and no failure, or why it failed. A cancelled
    /// read (the screen read again, or closed) changes nothing.
    private func read<Value>(
        _ value: ReferenceWritableKeyPath<Connection, Value?>,
        failure: ReferenceWritableKeyPath<Connection, String?>,
        _ call: (Client) async throws -> Value
    ) async {
        do {
            self[keyPath: value] = try await reading(call)
            self[keyPath: failure] = nil
        } catch {
            didFail(error, failure)
        }
    }

    /// A read, tried again when the server was out of reach: a network that blinks (a cell
    /// handover, the app back in front) shows nothing. Reads only: a write sent twice could act twice.
    private func reading<Value>(_ call: (Client) async throws -> Value) async throws -> Value {
        try await Self.retrying(after: Self.retryDelays) {
            try await call(requiredClient())
        } beforeRetry: {
            // Look for the server again: the address that answered may be the one that went away.
            connecting = nil
            retries += 1
        } afterRetry: {
            retries -= 1
        }
    }

    /// 1 s then 3 s: past a cell handover, before the user waits on a spinner.
    private static let retryDelays: [Duration] = [.seconds(1), .seconds(3)]

    /// Runs `attempt` again after each delay while it fails for want of the server; any other
    /// failure, or the last one, is thrown.
    static func retrying<Value>(
        after delays: [Duration],
        _ attempt: () async throws -> Value,
        beforeRetry: () -> Void = {},
        afterRetry: () -> Void = {}
    ) async throws -> Value {
        for delay in delays {
            do {
                return try await attempt()
            } catch let error where error.isConnectionFailure {
                beforeRetry()
                defer { afterRetry() }
                try await Task.sleep(for: delay)
            }
        }
        return try await attempt()
    }

    private func didFail(_ error: any Error, _ failure: ReferenceWritableKeyPath<Connection, String?>) {
        switch ReadFailure(error, shown: self[keyPath: failure]) {
        case let .server(message):
            lastError = message
            self[keyPath: failure] = nil
        case let .screen(message):
            self[keyPath: failure] = message
        }
    }

    private func send(_ call: (Client) async throws -> Void) async {
        guard let client = await authenticatedClient() else { return }
        do {
            try await call(client)
        } catch {
            lastError = error.message(replacing: lastError)
        }
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

/// What a tab shows, read each time it opens.
enum TabRead: Equatable {
    case fixes, homeTiles, requests, upcoming, library, journal
}

extension AppTab {
    /// Run together; Settings and Search read on demand.
    var reads: [TabRead] {
        switch self {
        case .home: [.fixes, .homeTiles, .requests, .upcoming, .library]
        case .library: [.library]
        case .activity: [.journal]
        case .settings, .search: []
        }
    }
}

/// Where a failed read is said. The server out of reach shows once, as the server's status (the
/// dot beside each tab's title, Settings), never as a card on each screen: the screen keeps what
/// it shows. Anything else is that screen's own failure.
enum ReadFailure: Equatable {
    case server(String)
    /// Nil keeps nothing; a cancelled read keeps what the screen showed.
    case screen(String?)

    init(_ error: any Error, shown: String?) {
        self = error.isConnectionFailure ? .server(error.quaiMessage) : .screen(error.message(replacing: shown))
    }
}
