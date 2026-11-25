import Foundation
import Testing
@testable import Quai

@MainActor
struct FlowSubjectsTests {
    private let requestActivity = ##"{"attributes":{"key":"requests|request:1","flowId":"requests","title":"Send Help","color":"#8B8CF8","icon":"person.badge.clock","steps":[{"id":"pending","label":"To approve","icon":"person.badge.clock"}]},"content":{"step":0,"tone":"active"}}"##
    private let requestsFlow = ##"{"id":"requests","name":"Requests","enabled":true,"subject":"request","color":"#8B8CF8","icon":"person.badge.clock","steps":[{"id":"pending","label":"To approve","icon":"person.badge.clock"}]}"##

    private func activities(_ json: String) throws -> [RunningActivity] {
        try JSONDecoder().decode([RunningActivity].self, from: Data("[\(json)]".utf8))
    }

    private func flows(_ json: String) throws -> [Components.Schemas.FlowSummary] {
        try JSONDecoder().decode([Components.Schemas.FlowSummary].self, from: Data("[\(json)]".utf8))
    }

    @Test func learnsANewFlowsSubjectBeforeItsActivityShows() async throws {
        let read = try activities(requestActivity)
        let all = try flows(requestsFlow)
        let subjects = await Connection.subjects(for: read, known: [:]) { all }
        #expect(subjects["requests"] == .request)
        // Its subject known, a request isn't live: it has its own tile on the Home.
        #expect(LiveNow(Today(read, subjects: subjects)).isEmpty)
    }

    @Test func activitiesComeWithTheirFlowsSubjects() async throws {
        let all = try flows(requestsFlow)
        let shown = await Connection.shown(try activities(requestActivity), known: [:]) { all }
        #expect(shown.activities.allSatisfy { shown.subjects[$0.attributes.flowId] != nil })
        #expect(LiveNow(Today(shown.activities, subjects: shown.subjects)).isEmpty)
    }

    @Test func readsTheFlowsOnlyWhenAnActivitysFlowIsNew() async throws {
        let read = try activities(requestActivity)
        var loads = 0
        let subjects = await Connection.subjects(for: read, known: ["requests": .request]) {
            loads += 1
            return nil
        }
        #expect(loads == 0)
        #expect(subjects == ["requests": .request])
    }

    @Test func aFailedReadKeepsWhatWasKnown() async throws {
        let read = try activities(requestActivity)
        let subjects = await Connection.subjects(for: read, known: ["download": .media]) { nil }
        #expect(subjects == ["download": .media])
    }
}
