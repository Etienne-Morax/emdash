import AVFoundation
import MoraxCodeKit
import MoraxDesign
import SwiftUI
import VisionKit

/// First run: scan the QR code under Settings → Interface → Mobile access on the Mac, or
/// type the address and code it shows.
struct PairingView: View {
  @Environment(AppModel.self) private var model
  @State private var address = ""
  @State private var code = ""
  @State private var error: String?
  @State private var isPairing = false
  @State private var isScanning = false
  private static let maxContentWidth: CGFloat = 560

  var body: some View {
    ZStack {
      MeshBackground().ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          ScreenHeader("Pair with your Mac", eyebrow: "Morax Code")
          if DataScannerViewController.isSupported {
            Button {
              isScanning = true
            } label: {
              Label("Scan the QR code", systemImage: "qrcode.viewfinder")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
          }
          VStack(alignment: .leading, spacing: 14) {
            Text("Mac address").moraxEyebrowStyle()
            TextField("my-mac.tail1234.ts.net:8443", text: $address)
              .textContentType(.URL)
              .keyboardType(.URL)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .padding(14)
              .background(.thinMaterial, in: .rect(cornerRadius: 12))
            Text("Pairing code").moraxEyebrowStyle()
            TextField("ABCD2345", text: $code)
              .textInputAutocapitalization(.characters)
              .autocorrectionDisabled()
              .font(.system(.title3, design: .monospaced))
              .padding(14)
              .background(.thinMaterial, in: .rect(cornerRadius: 12))
              .accessibilityLabel("Pairing code")
            if let error {
              Text(error).foregroundStyle(Palette.dangerText).font(.callout)
            }
            Button {
              Task { await pairTyped() }
            } label: {
              Text(isPairing ? "Pairing…" : "Pair").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isPairing || code.isEmpty || address.isEmpty)
          }
          .padding(20)
          .glassCard()
          VStack(alignment: .leading, spacing: 10) {
            Label("On the Mac: Emdash → Settings → Interface → Mobile access.", systemImage: "1.circle")
            Label("Publish it on your tailnet: tailscale serve --bg --https=8443 http://127.0.0.1:7781", systemImage: "2.circle")
            Label("Keep Tailscale on, then Pair a device and scan the code.", systemImage: "3.circle")
          }
          .font(.callout)
          .foregroundStyle(.secondary)
        }
        .padding(20)
        // Readable column on iPad and in wide windows.
        .frame(maxWidth: Self.maxContentWidth)
        .frame(maxWidth: .infinity)
      }
    }
    .tint(Palette.accent)
    .sheet(isPresented: $isScanning) {
      QRScanner { text in
        isScanning = false
        guard let link = PairingLink.parse(text) else {
          error = "That QR code is not a Morax Code pairing code."
          return
        }
        Task { await pair(link) }
      }
      .ignoresSafeArea()
    }
  }

  private func pairTyped() async {
    switch GatewayAddress.parse(address) {
    case .failure(let failure):
      error = GatewayAddress.message(for: failure)
    case .success(let gateway):
      await pair(PairingLink(gateway: gateway, code: PairingLink.normalizeCode(code)))
    }
  }

  private func pair(_ link: PairingLink) async {
    isPairing = true
    error = nil
    defer { isPairing = false }
    do {
      try await model.pair(link)
      await model.notifier.requestPermission()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// Live camera QR reader (VisionKit).
struct QRScanner: UIViewControllerRepresentable {
  let onCode: (String) -> Void

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
    scanner.delegate = context.coordinator
    try? scanner.startScanning()
    return scanner
  }

  func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    let onCode: (String) -> Void
    private var done = false
    init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

    func dataScanner(
      _ scanner: DataScannerViewController, didAdd items: [RecognizedItem],
      allItems: [RecognizedItem]
    ) {
      for item in items {
        if case .barcode(let barcode) = item, let text = barcode.payloadStringValue, !done {
          done = true
          scanner.stopScanning()
          onCode(text)
        }
      }
    }
  }
}
