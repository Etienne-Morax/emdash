/// Applies the Immer patches Wire live states emit as update deltas
/// (`[{ op: "add" | "replace" | "remove", path: [String | Int], value? }]`).
public enum ImmerPatch {
  public enum PatchError: Error, Equatable {
    case malformed
    case badPath
  }

  public static func apply(_ patches: JSONValue, to state: JSONValue) throws -> JSONValue {
    guard case .array(let list) = patches else { throw PatchError.malformed }
    var result = state
    for patch in list {
      guard let op = patch["op"]?.stringValue, case .array(let path)? = patch["path"] else {
        throw PatchError.malformed
      }
      result = try applyOne(op: op, path: path[...], value: patch["value"], to: result)
    }
    return result
  }

  private static func applyOne(
    op: String, path: ArraySlice<JSONValue>, value: JSONValue?, to node: JSONValue
  ) throws -> JSONValue {
    guard let head = path.first else {
      // A root replace swaps the whole state.
      guard op == "replace" || op == "add", let value else { throw PatchError.malformed }
      return value
    }
    let rest = path.dropFirst()
    switch node {
    case .object(var object):
      guard let key = head.stringValue else { throw PatchError.badPath }
      if rest.isEmpty {
        switch op {
        case "add", "replace":
          guard let value else { throw PatchError.malformed }
          object[key] = value
        case "remove": object.removeValue(forKey: key)
        default: throw PatchError.malformed
        }
      } else {
        guard let child = object[key] else { throw PatchError.badPath }
        object[key] = try applyOne(op: op, path: rest, value: value, to: child)
      }
      return .object(object)
    case .array(var array):
      if head.stringValue == "length", rest.isEmpty, op == "replace",
        let length = value?.numberValue
      {
        let count = Int(length)
        guard count >= 0, count <= array.count else { throw PatchError.badPath }
        return .array(Array(array.prefix(count)))
      }
      guard let index = arrayIndex(head, count: array.count, op: op, isLeaf: rest.isEmpty) else {
        throw PatchError.badPath
      }
      if rest.isEmpty {
        switch op {
        case "add":
          guard let value else { throw PatchError.malformed }
          array.insert(value, at: index)
        case "replace":
          guard let value, index < array.count else { throw PatchError.badPath }
          array[index] = value
        case "remove":
          guard index < array.count else { throw PatchError.badPath }
          array.remove(at: index)
        default: throw PatchError.malformed
        }
      } else {
        guard index < array.count else { throw PatchError.badPath }
        array[index] = try applyOne(op: op, path: rest, value: value, to: array[index])
      }
      return .array(array)
    default:
      throw PatchError.badPath
    }
  }

  private static func arrayIndex(_ key: JSONValue, count: Int, op: String, isLeaf: Bool) -> Int? {
    if key.stringValue == "-" { return count }
    let raw: Double? = key.numberValue ?? key.stringValue.flatMap(Double.init)
    guard let raw, raw >= 0, raw.rounded() == raw else { return nil }
    let index = Int(raw)
    let limit = (isLeaf && op == "add") ? count : count - 1
    return index <= limit ? index : nil
  }
}
