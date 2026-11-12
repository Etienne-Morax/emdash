import MoraxDesign
import SwiftUI

@main
struct EmdashMobileApp: App {
    @State private var settings = GatewaySettings()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
                .moraxType()
        }
    }
}
