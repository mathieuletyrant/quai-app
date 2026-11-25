import Foundation
import HTTPTypes
import OpenAPIRuntime

/// A header the reverse proxy in front of Quai Cloud requires (a Cloudflare Access service token,
/// a Pangolin or Authelia header token…). Set on the Cloud with `QUAI_CLOUD_PUBLIC_HEADERS`, it comes
/// with the pairing link, or is typed in Settings → Connection. The value is a secret: it lives in
/// the Keychain with the device token.
struct AccessHeader: Codable, Hashable, Sendable {
    var name: String
    var value: String

    init(name: String, value: String) {
        self.name = name
        self.value = value
    }

    /// `Name: value`, as the pairing link carries it.
    init?(pair: String) {
        guard let colon = pair.firstIndex(of: ":") else { return nil }
        let name = pair[..<colon].trimmingCharacters(in: .whitespaces)
        let value = pair[pair.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        guard Self.problem(name: name, value: value, among: []) == nil else { return nil }
        self.init(name: name, value: value)
    }

    /// Headers the app or the HTTP stack owns, or that would break the request: the device token
    /// is `Authorization: Bearer`, URLSession reserves some, and hop-by-hop ones never reach the
    /// proxy as sent. The same list as Quai Cloud's.
    static let reserved: Set<String> = [
        "authorization", "proxy-authorization", "proxy-authenticate", "www-authenticate",
        "host", "content-type", "content-length", "cookie",
        "connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "expect",
    ]

    /// RFC 7230 `token`: what a header name may be made of.
    private static let tokenCharacters = CharacterSet(charactersIn: "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

    /// Why this header can't be sent, in words for the user; nil when it can. `others` are the
    /// headers already set, to refuse the same name twice.
    static func problem(name: String, value: String, among others: [AccessHeader]) -> String? {
        let lowered = name.lowercased()
        if name.isEmpty || !name.unicodeScalars.allSatisfy({ tokenCharacters.contains($0) }) {
            return "A header name is letters, digits and - only, with no space."
        }
        if reserved.contains(lowered) { return "Quai sets \(name) itself." }
        if others.contains(where: { $0.name.lowercased() == lowered }) { return "\(name) is already set." }
        let visibleASCII = value.unicodeScalars.allSatisfy { $0 == "\t" || (0x20 ... 0x7E).contains($0.value) }
        if value.isEmpty || !visibleASCII { return "The value is empty or has characters a header can't carry." }
        return nil
    }

    /// What Settings shows instead of the value.
    static let masked = "••••••••"
}

/// Sends the access headers on every request to Quai Cloud, and tells a refusal from the proxy
/// in front of it apart from one from Quai.
struct AccessHeadersMiddleware: ClientMiddleware {
    let headers: [AccessHeader]

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        for header in headers {
            if let name = HTTPField.Name(header.name) { request.headerFields[name] = header.value }
        }
        let (response, responseBody) = try await next(request, body, baseURL)
        if Self.isBlockedByProxy(response) { throw ConnectionError.blockedByProxy }
        return (response, responseBody)
    }

    /// Quai's API answers JSON only, its 401 and 403 included. A web page (a proxy's login page,
    /// reached through its redirect), or a 401/403 that isn't JSON, comes from a proxy on the way.
    static func isBlockedByProxy(_ response: HTTPResponse) -> Bool {
        isBlockedByProxy(status: response.status.code, contentType: response.headerFields[.contentType])
    }

    static func isBlockedByProxy(status: Int, contentType: String?) -> Bool {
        let contentType = contentType?.lowercased() ?? ""
        if contentType.contains("text/html") { return true }
        return (status == 401 || status == 403) && !contentType.contains("json")
    }
}

extension Error {
    /// The Quai error inside the OpenAPI client's wrapper (a middleware's, say), or this one.
    var quaiError: any Error {
        if let wrapped = self as? ClientError { return wrapped.underlyingError.quaiError }
        return self
    }

    /// What to show the user.
    var quaiMessage: String { quaiError.localizedDescription }

    /// The call was cancelled (its screen closed, the app left the front), not refused: nothing to show.
    var isCancellation: Bool {
        let error = quaiError
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        return false
    }

    /// What a screen's read shows after failing: a cancelled call (the screen read again, closed) keeps
    /// what it showed, since another read follows or nobody sees it.
    func message(replacing shown: String?) -> String? {
        isCancellation ? shown : quaiMessage
    }

    var isBlockedByProxy: Bool {
        if case .blockedByProxy? = quaiError as? ConnectionError { return true }
        return false
    }
}
