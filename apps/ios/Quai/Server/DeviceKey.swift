import CryptoKit
import Foundation

/// The device key: an Ed25519 key pair made at pairing. Its private half never leaves this iPhone
/// (the Keychain, this device only); Quai Home keeps the public one and answers only the requests
/// this key signed, so Quai Cloud, which carries them, can neither make one nor play one again.
struct DeviceKey: Sendable, Equatable {
    /// The private key's 32 bytes.
    let seed: Data

    init() {
        seed = Curve25519.Signing.PrivateKey().rawRepresentation
    }

    /// Nil when these bytes aren't a key.
    init?(seed: Data) {
        guard (try? Curve25519.Signing.PrivateKey(rawRepresentation: seed)) != nil else { return nil }
        self.seed = seed
    }

    /// The public half, as the pairing sends it: its 32 raw bytes, base64.
    var publicKey: String {
        (try? Curve25519.Signing.PrivateKey(rawRepresentation: seed).publicKey.rawRepresentation.base64EncodedString()) ?? ""
    }

    static let timeHeader = "x-quai-time"
    static let nonceHeader = "x-quai-nonce"
    static let signatureHeader = "x-quai-signature"

    /// The SHA-256 of a body as sent, in hex; of nothing, for a request without one.
    static func bodyHash(_ body: Data) -> String {
        SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
    }

    /// A request as its signature covers it: its method, its path and query as sent, its body.
    struct Request: Sendable {
        let method: String
        let path: String
        var body = Data()
    }

    /// What the key signs, the same on the server (`packages/api/src/RequestSignature.ts`): the
    /// method, the path and query percent-decoded (as it is when it can't be), the time, the nonce
    /// and the body's hash, one per line.
    static func payload(_ request: Request, time: String, nonce: String) -> String {
        let path = request.path.removingPercentEncoding ?? request.path
        return ["quai-request", request.method.uppercased(), path, time, nonce, bodyHash(request.body)]
            .joined(separator: "\n")
    }

    /// The three headers that sign a request: this iPhone's clock (epoch milliseconds), a nonce of
    /// its own, and the signature. Empty if the key can't sign, which a key that was read can.
    func headers(_ request: Request, now: Date = .now, nonce: String = UUID().uuidString) -> [String: String] {
        let time = String(Int64((now.timeIntervalSince1970 * 1000).rounded()))
        let payload = Self.payload(request, time: time, nonce: nonce)
        guard let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: seed),
              let signature = try? key.signature(for: Data(payload.utf8))
        else { return [:] }
        return [
            Self.timeHeader: time,
            Self.nonceHeader: nonce,
            Self.signatureHeader: signature.base64EncodedString(),
        ]
    }
}
