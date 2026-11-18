import Foundation
import Testing
@testable import Quai

struct DownloadStateTests {
    @Test func decodesServerPayload() throws {
        let json = #"{"step":"downloading","progress":0.5,"bytesPerSecond":1000,"remainingSeconds":60,"stalled":false}"#
        let state = try JSONDecoder().decode(DownloadActivityAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.step == .downloading)
        #expect(state.progress == 0.5)
    }
}
