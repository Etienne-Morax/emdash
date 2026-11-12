// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MoraxWire",
  platforms: [.iOS("26.0"), .macOS("15.0")],
  products: [
    .library(name: "MoraxWire", targets: ["MoraxWire"]),
    .library(name: "MoraxCodeKit", targets: ["MoraxCodeKit"]),
  ],
  targets: [
    /// The Wire protocol client (frames, calls, live states, logs, events, jobs).
    .target(name: "MoraxWire"),
    /// App logic without UI: gateway access, pairing, models, task board, new-task input.
    .target(name: "MoraxCodeKit", dependencies: ["MoraxWire"]),
    .testTarget(name: "MoraxWireTests", dependencies: ["MoraxWire"]),
    .testTarget(name: "MoraxCodeKitTests", dependencies: ["MoraxCodeKit"]),
  ]
)
