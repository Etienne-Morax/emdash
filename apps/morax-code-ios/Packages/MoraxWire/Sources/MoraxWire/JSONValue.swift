import Foundation

/// A JSON value as Wire carries it. Wire payloads are plain JSON, so the client keeps them
/// untyped and decodes the parts a screen needs (`decode(_:)`).
public enum JSONValue: Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public subscript(key: String) -> JSONValue? {
    if case .object(let object) = self { return object[key] }
    return nil
  }

  public subscript(index: Int) -> JSONValue? {
    if case .array(let array) = self, array.indices.contains(index) { return array[index] }
    return nil
  }

  public var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var numberValue: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  public var boolValue: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let value) = self { return value }
    return nil
  }

  public var objectValue: [String: JSONValue]? {
    if case .object(let value) = self { return value }
    return nil
  }
}

extension JSONValue: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSONValue].self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }
}

extension JSONValue {
  /// Parses UTF-8 JSON text.
  public static func parse(_ data: Data) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: data)
  }

  /// Builds a value from any `Encodable` (e.g. a call input struct).
  public static func from<T: Encodable>(_ value: T) throws -> JSONValue {
    try parse(JSONEncoder().encode(value))
  }

  /// Decodes this value into a `Decodable` model.
  public func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(serialized().utf8))
  }

  /// Serializes like JavaScript's `JSON.stringify`; `sortedKeys` gives Wire's stable form.
  public func serialized(sortedKeys: Bool = false) -> String {
    var out = ""
    write(into: &out, sortedKeys: sortedKeys)
    return out
  }

  private func write(into out: inout String, sortedKeys: Bool) {
    switch self {
    case .null: out += "null"
    case .bool(let value): out += value ? "true" : "false"
    case .number(let value): out += Self.format(value)
    case .string(let value): Self.quote(value, into: &out)
    case .array(let values):
      out += "["
      for (index, value) in values.enumerated() {
        if index > 0 { out += "," }
        value.write(into: &out, sortedKeys: sortedKeys)
      }
      out += "]"
    case .object(let object):
      out += "{"
      let keys = sortedKeys ? object.keys.sorted() : Array(object.keys)
      for (index, key) in keys.enumerated() {
        if index > 0 { out += "," }
        Self.quote(key, into: &out)
        out += ":"
        object[key]!.write(into: &out, sortedKeys: sortedKeys)
      }
      out += "}"
    }
  }

  private static func format(_ value: Double) -> String {
    guard value.isFinite else { return "null" }
    if value.rounded() == value, abs(value) < 1e15 { return String(Int64(value)) }
    return String(value)
  }

  /// JavaScript string escaping: `"`, `\`, and control characters only.
  private static func quote(_ value: String, into out: inout String) {
    out += "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    out += "\""
  }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByBooleanLiteral, ExpressibleByDictionaryLiteral, ExpressibleByArrayLiteral,
  ExpressibleByNilLiteral
{
  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
  }
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  public init(nilLiteral: ()) { self = .null }
}
