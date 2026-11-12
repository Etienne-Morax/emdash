// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MoraxWire",
  platforms: [.iOS("26.0"), .macOS("15.0")],
  products: [.library(name: "MoraxWire", targets: ["MoraxWire"])],
  targets: [
    .target(name: "MoraxWire"),
    .testTarget(name: "MoraxWireTests", dependencies: ["MoraxWire"]),
  ]
)
