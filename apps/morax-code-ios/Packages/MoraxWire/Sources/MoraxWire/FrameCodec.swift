import Foundation

/// Wire's binary framing (`packages/wire/src/api/transports/frame-codec.ts`):
///
/// JSON frame:   `[0x00][u32 header length][JSON header]`
/// Binary frame: `[0x01][u32 header length][JSON header][u32 body length][raw body]`
///
/// Over WebSocket each message carries exactly one frame. Binary frames carry blob chunks,
/// which the phone never requests; they decode with the body as `data` (base64).
public enum WireFrameCodec {
  static let jsonFrame: UInt8 = 0x00
  static let binaryFrame: UInt8 = 0x01
  /// Same bound as the TypeScript codec.
  public static let maxFrameBytes = 16 * 1024 * 1024

  public enum FrameError: Error, Equatable {
    case truncated
    case unknownKind(UInt8)
    case tooLarge
    case notJSON
  }

  public static func encode(_ message: JSONValue) -> Data {
    let header = Data(message.serialized().utf8)
    var frame = Data(capacity: 5 + header.count)
    frame.append(jsonFrame)
    appendU32(UInt32(header.count), to: &frame)
    frame.append(header)
    return frame
  }

  /// Decodes one complete frame.
  public static func decode(_ frame: Data) throws -> JSONValue {
    let bytes = [UInt8](frame)
    guard bytes.count >= 5 else { throw FrameError.truncated }
    let kind = bytes[0]
    guard kind == jsonFrame || kind == binaryFrame else { throw FrameError.unknownKind(kind) }
    let headerLength = Int(readU32(bytes, at: 1))
    guard headerLength <= maxFrameBytes else { throw FrameError.tooLarge }
    let headerEnd = 5 + headerLength
    guard bytes.count >= headerEnd else { throw FrameError.truncated }
    guard case .object(var header) = try? JSONValue.parse(Data(bytes[5..<headerEnd])) else {
      throw FrameError.notJSON
    }
    if kind == binaryFrame {
      guard bytes.count >= headerEnd + 4 else { throw FrameError.truncated }
      let bodyLength = Int(readU32(bytes, at: headerEnd))
      guard bodyLength <= maxFrameBytes else { throw FrameError.tooLarge }
      let bodyStart = headerEnd + 4
      guard bytes.count >= bodyStart + bodyLength else { throw FrameError.truncated }
      header["data"] = .string(Data(bytes[bodyStart..<bodyStart + bodyLength]).base64EncodedString())
    }
    return .object(header)
  }

  private static func appendU32(_ value: UInt32, to data: inout Data) {
    data.append(UInt8((value >> 24) & 0xFF))
    data.append(UInt8((value >> 16) & 0xFF))
    data.append(UInt8((value >> 8) & 0xFF))
    data.append(UInt8(value & 0xFF))
  }

  private static func readU32(_ bytes: [UInt8], at offset: Int) -> UInt32 {
    UInt32(bytes[offset]) << 24 | UInt32(bytes[offset + 1]) << 16
      | UInt32(bytes[offset + 2]) << 8 | UInt32(bytes[offset + 3])
  }
}
