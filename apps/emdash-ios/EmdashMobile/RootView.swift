import MoraxDesign
import SwiftUI

struct RootView: View {
    @Environment(GatewaySettings.self) private var settings
    @State private var loadError: String?
    @State private var reloadToken = 0
    @State private var isEditingAddress = false

    var body: some View {
        Group {
            if let url = settings.gatewayURL, !isEditingAddress {
                ZStack {
                    WebShellView(
                        url: url,
                        reloadToken: reloadToken,
                        onLoadFailure: { loadError = $0 },
                        onLoaded: { loadError = nil }
                    )
                    .ignoresSafeArea()
                    // Two-finger long press: change the address without leaving the app.
                    .simultaneousGesture(
                        LongPressGesture(minimumDuration: 1.2)
                            .onEnded { _ in isEditingAddress = true }
                    )
                    .accessibilityAction(named: "Change Mac address") { isEditingAddress = true }

                    if let loadError {
                        ConnectionErrorView(
                            message: loadError,
                            onRetry: {
                                self.loadError = nil
                                reloadToken += 1
                            },
                            onChangeAddress: { isEditingAddress = true }
                        )
                    }
                }
            } else {
                SetupView(
                    initialAddress: settings.gatewayURL?.absoluteString ?? "",
                    canCancel: settings.gatewayURL != nil,
                    onSave: { url in
                        settings.save(url)
                        loadError = nil
                        isEditingAddress = false
                    },
                    onCancel: { isEditingAddress = false }
                )
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct ConnectionErrorView: View {
    let message: String
    let onRetry: () -> Void
    let onChangeAddress: () -> Void

    var body: some View {
        ZStack {
            MeshBackground().ignoresSafeArea()
            VStack(alignment: .leading, spacing: 20) {
                ScreenHeader("Emdash is out of reach", eyebrow: "Emdash Mobile")
                Text(message)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    Button("Try again", action: onRetry)
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.accent)
                    Button("Change address", action: onChangeAddress)
                        .buttonStyle(.bordered)
                }
            }
            .padding(24)
            .glassCard()
            .padding(20)
        }
    }
}
