import Foundation
import Testing
@testable import Quai

/// Posters stay on the phone across launches, and the least recently shown go past the limit.
struct PosterDiskTests {
    private let poster = URL(string: "https://image.tmdb.org/t/p/w342/iKBFfOCdeu21lxxLxWaSAXxkmJ5.jpg")!

    private func emptyDisk(limit: Int = 200 << 20) -> PosterDisk {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        return PosterDisk(directory: directory, limit: limit)
    }

    @Test func aPosterNeverKeptIsNotThere() {
        #expect(emptyDisk().data(for: poster) == nil)
    }

    @Test func aKeptPosterIsThereAtTheNextLaunch() {
        let disk = emptyDisk()
        disk.store(Data([1, 2, 3]), for: poster)
        // Another launch: a new value on the same directory.
        let nextLaunch = PosterDisk(directory: disk.directory)
        #expect(nextLaunch.data(for: poster) == Data([1, 2, 3]))
    }

    @Test func eachPosterHasItsOwnFile() throws {
        let disk = emptyDisk()
        let other = try #require(URL(string: "https://image.tmdb.org/t/p/w342/other.jpg"))
        disk.store(Data([1]), for: poster)
        disk.store(Data([2]), for: other)
        #expect(disk.data(for: poster) == Data([1]))
        #expect(disk.data(for: other) == Data([2]))
    }

    @Test func theKeptDirectoryIsNotBackedUp() throws {
        let disk = emptyDisk()
        disk.store(Data([1]), for: poster)
        let values = try disk.directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(values.isExcludedFromBackup == true)
    }

    @Test func pastTheLimitTheLeastRecentlyShownGo() throws {
        let disk = emptyDisk(limit: 20)
        let old = try #require(URL(string: "https://image.tmdb.org/t/p/w342/old.jpg"))
        let shown = try #require(URL(string: "https://image.tmdb.org/t/p/w342/shown.jpg"))
        disk.store(Data(count: 10), for: old)
        disk.store(Data(count: 10), for: shown)
        disk.store(Data(count: 10), for: poster)
        // Ages every file, then shows one: it becomes the most recent.
        let files = try FileManager.default.contentsOfDirectory(at: disk.directory, includingPropertiesForKeys: nil)
        for file in files {
            try FileManager.default.setAttributes([.modificationDate: Date.distantPast], ofItemAtPath: file.path)
        }
        _ = disk.data(for: shown)
        _ = disk.data(for: poster)
        disk.prune()
        #expect(disk.data(for: old) == nil)
        #expect(disk.data(for: shown) != nil)
        #expect(disk.data(for: poster) != nil)
    }

    @Test func underTheLimitNothingGoes() {
        let disk = emptyDisk(limit: 100)
        disk.store(Data(count: 10), for: poster)
        disk.prune()
        #expect(disk.data(for: poster) != nil)
    }

    @Test func theSizeIsTheKeptPostersBytes() throws {
        let disk = emptyDisk()
        #expect(disk.size() == 0)
        disk.store(Data(count: 10), for: poster)
        try disk.store(Data(count: 5), for: #require(URL(string: "https://image.tmdb.org/t/p/w342/other.jpg")))
        #expect(disk.size() == 15)
    }

    @Test func clearedPostersAreGoneAndKeptAgainAfter() {
        let disk = emptyDisk()
        disk.store(Data([1]), for: poster)
        disk.clear()
        #expect(disk.data(for: poster) == nil)
        #expect(disk.size() == 0)
        disk.store(Data([2]), for: poster)
        #expect(disk.data(for: poster) == Data([2]))
    }

    @Test @MainActor func clearingThePostersEmptiesTheDiskAndCountsIt() async {
        let disk = emptyDisk()
        disk.store(Data(count: 10), for: poster)
        let posters = Posters(store: ImageStore(disk: disk))
        #expect(await posters.keptBytes() == 10)
        posters.clear()
        #expect(posters.cleared == 1)
        #expect(await posters.keptBytes() == 0)
        #expect(disk.data(for: poster) == nil)
    }
}
