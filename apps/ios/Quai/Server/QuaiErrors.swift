import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Turns every refusal from Quai Cloud into a `ConnectionError`, once for every route: a call
/// then reads only its success (`.ok`, `.noContent`, the generated throwing accessors). Listed
/// before `AccessHeadersMiddleware`, which tells a proxy's refusal apart first.
struct QuaiErrorsMiddleware: ClientMiddleware {
    // swiftlint:disable:next function_parameter_count - ClientMiddleware's own signature
    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        guard response.status.kind == .clientError || response.status.kind == .serverError else {
            return (response, responseBody)
        }
        var data = Data()
        if let responseBody {
            data = await (try? Data(collecting: responseBody, upTo: 64 * 1024)) ?? Data()
        }
        throw ConnectionError(status: response.status.code, body: data)
    }
}

extension ConnectionError {
    /// Quai's error answers are JSON with their `_tag`, and a `message` when there is something to
    /// say (the service's own words for a refused fix). Anything else is told by its status.
    init(status: Int, body: Data) {
        struct Answer: Decodable {
            let tag: String?
            let message: String?

            enum CodingKeys: String, CodingKey {
                case tag = "_tag"
                case message
            }
        }
        let answer = try? JSONDecoder().decode(Answer.self, from: body)
        switch answer?.tag {
        case "Unauthorized": self = .removed
        case "NotFound": self = .gone
        case "HomeOffline": self = .homeOffline
        case "InvalidPairingCode": self = .invalidCode
        default:
            if let message = answer?.message, !message.isEmpty {
                self = .refused(message)
            } else if status == 503 {
                self = .homeOffline
            } else {
                self = .server(status)
            }
        }
    }
}
