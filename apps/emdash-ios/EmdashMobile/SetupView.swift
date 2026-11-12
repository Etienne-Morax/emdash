import MoraxDesign
import SwiftUI

/// First run: where to find the Mac. The address comes from Emdash on the Mac
/// (Settings → Interface → Mobile access) once `tailscale serve` publishes it.
struct SetupView: View {
    let initialAddress: String
    let canCancel: Bool
    let onSave: (URL) -> Void
    let onCancel: () -> Void

    @State private var address: String
    @State private var error: GatewayAddressError?
    @FocusState private var isFocused: Bool

    init(
        initialAddress: String,
        canCancel: Bool,
        onSave: @escaping (URL) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.initialAddress = initialAddress
        self.canCancel = canCancel
        self.onSave = onSave
        self.onCancel = onCancel
        _address = State(initialValue: initialAddress)
    }

    var body: some View {
        ZStack {
            MeshBackground().ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ScreenHeader("Connect to your Mac", eyebrow: "Emdash Mobile")

                    VStack(alignment: .leading, spacing: 14) {
                        Text("Mac address")
                            .moraxEyebrowStyle()
                        TextField("my-mac.tail1234.ts.net:8443", text: $address)
                            .textContentType(.URL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .focused($isFocused)
                            .onSubmit(save)
                            .padding(14)
                            .background(.thinMaterial, in: .rect(cornerRadius: 12))
                        if let error {
                            Text(GatewayAddress.message(for: error))
                                .foregroundStyle(Palette.dangerText)
                                .font(.callout)
                        }
                        Button(action: save) {
                            Text("Connect").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.accent)
                        .controlSize(.large)
                        if canCancel {
                            Button("Cancel", action: onCancel)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(20)
                    .glassCard()

                    VStack(alignment: .leading, spacing: 10) {
                        Label("Turn on Mobile access in Emdash on your Mac.", systemImage: "1.circle")
                        Label("Publish it on your tailnet: tailscale serve --bg --https=8443 http://127.0.0.1:7781", systemImage: "2.circle")
                        Label("Keep Tailscale connected on this iPhone, then pair with the code your Mac shows.", systemImage: "3.circle")
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
                .padding(20)
            }
        }
        .onAppear { isFocused = initialAddress.isEmpty }
    }

    private func save() {
        switch GatewayAddress.parse(address) {
        case let .success(url):
            error = nil
            onSave(url)
        case let .failure(failure):
            error = failure
        }
    }
}
