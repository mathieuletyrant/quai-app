import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Signs every request with the device key, as the home's `DeviceAuth` expects of an iPhone paired
/// with one. Listed last: it signs the request as it leaves, its body included.
struct SigningMiddleware: ClientMiddleware {
    let key: DeviceKey

    /// More than any request of the app carries.
    private static let bodyLimit = 4 * 1024 * 1024

    // swiftlint:disable:next function_parameter_count - ClientMiddleware's own signature
    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        // The body is read once to sign it, then sent as it was read.
        var sent: Data?
        if let body { sent = try await Data(collecting: body, upTo: Self.bodyLimit) }
        var request = request
        let signed = DeviceKey.Request(method: request.method.rawValue, path: request.path ?? "/", body: sent ?? Data())
        for (name, value) in key.headers(signed) {
            if let field = HTTPField.Name(name) { request.headerFields[field] = value }
        }
        return try await next(request, sent.map { HTTPBody($0) }, baseURL)
    }
}
