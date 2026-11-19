import ActivityKit
import Foundation
import Observation
import OpenAPIRuntime
import OpenAPIURLSession

enum ConnectionError: LocalizedError {
    case unreachable
    case invalidCode
    case homeOffline
    case server(Int)

    var errorDescription: String? {
        switch self {
        case .unreachable: "Can't reach the Quai server. On Wi-Fi at home, or check the address."
        case .homeOffline: "Quai Home isn't connected to Quai Cloud. Check that it runs on your server."
        case .invalidCode: "This code is unknown, already used or expired. Show a new one in the console."
        case let .server(status): "The server answered \(status)."
        }
    }
}

/// The link between this iPhone and its Quai server: pairing, tokens, and the running activities.
@MainActor @Observable
final class Connection {
    private(set) var serverURL: URL?
    private(set) var activities: [Components.Schemas.RunningActivity] = []
    private(set) var lastError: String?
    private var session: ServerSession?
    /// Arrives from ActivityKit at any time, before or after pairing.
    private var pushToStartToken: String?

    var isPaired: Bool { session != nil }

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
        guard let url = await ServerSession.firstReachable(link.serverURLs) else { throw ConnectionError.unreachable }
        let client = Client(serverURL: url, transport: URLSessionTransport())
        let body = Components.Schemas.PairDevice(
            code: link.code,
            name: name,
            apnsEnvironment: Self.apnsEnvironment,
            pushToStartToken: pushToStartToken
        )
        switch try await client.pairDevice(body: .json(body)) {
        case let .ok(ok):
            let paired = try ok.body.json
            let session = ServerSession(token: paired.token, urls: [url] + link.serverURLs.filter { $0 != url })
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

    func disconnect() {
        ServerSession.clear()
        session = nil
        serverURL = nil
        activities = []
    }

    // MARK: Preferences

    func preferences() async throws -> Components.Schemas.DevicePreferences {
        guard let client = await authenticatedClient() else { throw ConnectionError.unreachable }
        switch try await client.getPreferences() {
        case let .ok(ok): return try ok.body.json
        case .unauthorized: throw ConnectionError.server(401)
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    func save(_ preferences: Components.Schemas.DevicePreferences) async throws {
        guard let client = await authenticatedClient() else { throw ConnectionError.unreachable }
        switch try await client.savePreferences(body: .json(preferences)) {
        case .ok: return
        case .unauthorized: throw ConnectionError.server(401)
        case .serviceUnavailable: throw ConnectionError.homeOffline
        case let .undocumented(statusCode, _): throw ConnectionError.server(statusCode)
        }
    }

    func flows() async throws -> [Components.Schemas.FlowSummary] {
        guard let client = await authenticatedClient() else { throw ConnectionError.unreachable }
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
            case .unauthorized:
                lastError = "This iPhone was removed from the console. Pair it again."
            case .serviceUnavailable:
                lastError = ConnectionError.homeOffline.localizedDescription
            case let .undocumented(statusCode, _):
                lastError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            lastError = error.localizedDescription
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
        do { try await call(client) } catch { lastError = error.localizedDescription }
    }

    /// Prefers the address that answered last; on another network, tries the others.
    private func authenticatedClient() async -> Client? {
        guard let session else { return nil }
        guard let (url, client) = await session.connect(preferring: serverURL) else {
            lastError = ConnectionError.unreachable.localizedDescription
            return nil
        }
        serverURL = url
        return client
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
