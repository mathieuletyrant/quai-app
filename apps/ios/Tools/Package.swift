// swift-tools-version:5.10
// The generator behind scripts/gen-client.sh: the app's client is generated once and committed,
// so the iPhone build doesn't compile the generator.
import PackageDescription

let package = Package(
    name: "QuaiTools",
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.4"),
    ]
)
