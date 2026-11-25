import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Adds the device token to every request, as the server's `DeviceAuth` expects.
struct BearerMiddleware: ClientMiddleware {
    let token: String

    // swiftlint:disable:next function_parameter_count - ClientMiddleware's own signature
    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[.authorization] = "Bearer \(token)"
        return try await next(request, body, baseURL)
    }
}
