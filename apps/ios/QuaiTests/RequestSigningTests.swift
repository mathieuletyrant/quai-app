import CryptoKit
import Foundation
import Testing
@testable import Quai

/// The same known key, request and signature as the server's tests
/// (`apps/cloud/test/home/requestSignature.test.ts`): both sides sign alike.
struct RequestSigningTests {
    let seed = Data((1...32).map { UInt8($0) })
    let path = "/api/search?query=l%27%C3%A9t%C3%A9%20indien"
    let body = Data("{\"note\":\"é\"}".utf8)
    let bodyHash = "6442fa400575468d43a22425ba3cc684670d3b02d8b855ce32b6f1e99a03909b"
    let serverSignature = "taQFlKbZZcL6WsfB4rBWQW14HOjcKk1D6zObXE1Icl4M1r6Hhn8/OKj/RVz4MIerMoYYp49KbcyXcAzTFUQ8BQ=="

    var payload: String {
        "quai-request\nPOST\n/api/search?query=l'été indien\n1795780000000\nn-0001\n\(bodyHash)"
    }

    @Test func theKeysPublicHalfIsWhatThePairingSends() throws {
        let key = try #require(DeviceKey(seed: seed))
        #expect(key.publicKey == "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=")
        #expect(DeviceKey(seed: Data([1, 2, 3])) == nil)
        #expect(DeviceKey().seed.count == 32)
        #expect(key.seed != DeviceKey().seed)
    }

    @Test func whatIsSignedIsTheServersPayload() {
        #expect(DeviceKey.bodyHash(body) == bodyHash)
        let request = DeviceKey.Request(method: "post", path: path, body: body)
        #expect(DeviceKey.payload(request, time: "1795780000000", nonce: "n-0001") == payload)
        // No body: the hash of nothing. A path that can't be decoded is signed as it is.
        let empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        let odd = DeviceKey.Request(method: "GET", path: "/api/x?q=100%")
        #expect(DeviceKey.payload(odd, time: "1", nonce: "n") == "quai-request\nGET\n/api/x?q=100%\n1\nn\n\(empty)")
    }

    @Test func theServersSignatureOfTheVectorIsThisKeys() throws {
        let publicKey = try Curve25519.Signing.PrivateKey(rawRepresentation: seed).publicKey
        let signature = try #require(Data(base64Encoded: serverSignature))
        #expect(publicKey.isValidSignature(signature, for: Data(payload.utf8)))
    }

    @Test func aRequestCarriesItsTimeItsNonceAndASignatureTheKeyMade() throws {
        let key = try #require(DeviceKey(seed: seed))
        let now = Date(timeIntervalSince1970: 1_795_780_000)
        let headers = key.headers(DeviceKey.Request(method: "POST", path: path, body: body), now: now, nonce: "n-0001")
        #expect(headers[DeviceKey.timeHeader] == "1795780000000")
        #expect(headers[DeviceKey.nonceHeader] == "n-0001")
        let signature = try #require(Data(base64Encoded: headers[DeviceKey.signatureHeader] ?? ""))
        let publicKey = try Curve25519.Signing.PrivateKey(rawRepresentation: seed).publicKey
        #expect(publicKey.isValidSignature(signature, for: Data(payload.utf8)))
        // Another body is another signature: not this one.
        let changed = DeviceKey.Request(method: "POST", path: path, body: Data("{}".utf8))
        let other = DeviceKey.payload(changed, time: "1795780000000", nonce: "n-0001")
        #expect(!publicKey.isValidSignature(signature, for: Data(other.utf8)))
    }

    @Test func eachRequestHasANonceOfItsOwn() throws {
        let key = try #require(DeviceKey(seed: seed))
        let request = DeviceKey.Request(method: "GET", path: "/api/library")
        let first = key.headers(request)
        let second = key.headers(request)
        #expect(first[DeviceKey.nonceHeader] != second[DeviceKey.nonceHeader])
        #expect(first.count == 3)
    }
}
