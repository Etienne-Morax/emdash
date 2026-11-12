import Foundation
@testable import MoraxWire

/// Fixtures recorded from the TypeScript implementation (`apps/morax-code-ios/Fixtures`).
enum Fixtures {
  static let directory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("../../../../Fixtures")
    .standardizedFileURL

  static func load(_ name: String) throws -> JSONValue {
    try JSONValue.parse(Data(contentsOf: directory.appendingPathComponent(name)))
  }

  static func hex(_ string: String) -> Data {
    var data = Data(capacity: string.count / 2)
    var index = string.startIndex
    while index < string.endIndex {
      let next = string.index(index, offsetBy: 2)
      data.append(UInt8(string[index..<next], radix: 16)!)
      index = next
    }
    return data
  }
}
