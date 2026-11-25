// swift-tools-version:5.10
// The tools the CI runs on Linux: the generator behind scripts/gen-client.sh (the app's client is
// generated, so the iPhone build doesn't compile the generator), SwiftFormat, which checks the
// app's code against ../.swiftformat (scripts/format.sh), and SwiftLint, which checks it against
// ../.swiftlint.yml (scripts/lint.sh).
import PackageDescription

let package = Package(
    name: "QuaiTools",
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.4"),
        .package(url: "https://github.com/nicklockwood/SwiftFormat", exact: "0.64.7"),
        .package(url: "https://github.com/realm/SwiftLint", exact: "0.65.1"),
    ]
)
