// Renders the Morax Code app icons from the square source logo.
// Usage: swift render-icons.swift <source.png> <output-dir>
// Run through generate-icons.sh, which also builds the .icns files with sips + iconutil.
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Outer bounds of the logo's metallic frame inside the 1254x1254 source image.
let sourceCrop = CGRect(x: 24, y: 18, width: 1204, height: 1204)

// macOS Big Sur+ icon grid: 824pt artwork centred on a 1024pt canvas.
let canvasSize = 1024
let gridContentSize: CGFloat = 824
// Matches the logo frame's own corner radius so the frame stays intact.
let cornerRadiusRatio: CGFloat = 0.19
let shadowBlur: CGFloat = 28
let shadowOffsetY: CGFloat = -12
let shadowAlpha: CGFloat = 0.35
let badgeHeightRatio: CGFloat = 0.17

struct Badge {
  let text: String
  let red: CGFloat
  let green: CGFloat
  let blue: CGFloat
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func loadImage(_ path: String) -> CGImage {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { fail("Cannot read image: \(path)") }
  return image
}

func makeContext(width: Int, height: Int) -> CGContext {
  guard
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { fail("Cannot create bitmap context") }
  context.interpolationQuality = .high
  return context
}

func writePNG(_ context: CGContext, to path: String) {
  guard let image = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(
      URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)
  else { fail("Cannot write \(path)") }
  CGImageDestinationAddImage(destination, image, nil)
  if !CGImageDestinationFinalize(destination) { fail("Cannot finalize \(path)") }
}

func drawCentredText(
  _ text: String, in rect: CGRect, fontSize: CGFloat, context: CGContext, color: CGColor
) {
  let font = CTFontCreateWithName("Helvetica-Bold" as CFString, fontSize, nil)
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
  ]
  let line = CTLineCreateWithAttributedString(
    NSAttributedString(string: text, attributes: attributes))
  let bounds = CTLineGetImageBounds(line, context)
  context.textPosition = CGPoint(
    x: rect.midX - bounds.width / 2 - bounds.minX,
    y: rect.midY - bounds.height / 2 - bounds.minY)
  CTLineDraw(line, context)
}

func renderIcon(
  logo: CGImage, contentSize: CGFloat, withShadow: Bool, badge: Badge?, to path: String
) {
  let context = makeContext(width: canvasSize, height: canvasSize)
  let inset = (CGFloat(canvasSize) - contentSize) / 2
  let rect = CGRect(x: inset, y: inset, width: contentSize, height: contentSize)
  let radius = contentSize * cornerRadiusRatio
  let shape = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

  if withShadow {
    context.saveGState()
    context.setShadow(
      offset: CGSize(width: 0, height: shadowOffsetY), blur: shadowBlur,
      color: CGColor(gray: 0, alpha: shadowAlpha))
    context.addPath(shape)
    context.setFillColor(CGColor(gray: 0, alpha: 1))
    context.fillPath()
    context.restoreGState()
  }

  context.saveGState()
  context.addPath(shape)
  context.clip()
  context.draw(logo, in: rect)
  if let badge {
    let band = CGRect(
      x: rect.minX, y: rect.minY, width: rect.width, height: rect.height * badgeHeightRatio)
    context.setFillColor(CGColor(srgbRed: badge.red, green: badge.green, blue: badge.blue, alpha: 1))
    context.fill(band)
    drawCentredText(
      badge.text, in: band, fontSize: band.height * 0.55, context: context,
      color: CGColor(gray: 0.08, alpha: 1))
  }
  context.restoreGState()
  writePNG(context, to: path)
}

// Monochrome menu-bar template: filled rounded square with a knocked-out "M".
func renderTrayTemplate(size: Int, to path: String) {
  let context = makeContext(width: size, height: size)
  let scale = CGFloat(size) / 16
  let rect = CGRect(x: 1, y: 1, width: 14, height: 14).applying(
    CGAffineTransform(scaleX: scale, y: scale))
  let radius = 3.5 * scale
  context.addPath(
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
  context.setFillColor(CGColor(gray: 0, alpha: 1))
  context.fillPath()
  context.setBlendMode(.clear)
  drawCentredText(
    "M", in: rect, fontSize: 10.5 * scale, context: context, color: CGColor(gray: 0, alpha: 1))
  writePNG(context, to: path)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else { fail("Usage: render-icons.swift <source.png> <output-dir>") }
let outputDir = arguments[2]
guard let logo = loadImage(arguments[1]).cropping(to: sourceCrop) else {
  fail("Source logo is smaller than the expected crop")
}

let devBadge = Badge(text: "DEV", red: 0.96, green: 0.55, blue: 0.13)
let canaryBadge = Badge(text: "CANARY", red: 1.0, green: 0.84, blue: 0.04)
let fullBleed = CGFloat(canvasSize)

renderIcon(logo: logo, contentSize: gridContentSize, withShadow: true, badge: nil,
  to: "\(outputDir)/emdash.png")
renderIcon(logo: logo, contentSize: gridContentSize, withShadow: true, badge: devBadge,
  to: "\(outputDir)/emdash-dev.png")
renderIcon(logo: logo, contentSize: gridContentSize, withShadow: true, badge: canaryBadge,
  to: "\(outputDir)/emdash-canary.png")
renderIcon(logo: logo, contentSize: fullBleed, withShadow: false, badge: nil,
  to: "\(outputDir)/icon-light.png")
renderTrayTemplate(size: 16, to: "\(outputDir)/trayTemplate.png")
renderTrayTemplate(size: 32, to: "\(outputDir)/trayTemplate@2x.png")
