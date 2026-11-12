import SwiftUI
import UIKit
import WebKit

/// The phone app served by Emdash Mobile access, full screen. Navigation stays on the gateway
/// origin; any other link opens in Safari.
struct WebShellView: UIViewRepresentable {
    let url: URL
    let reloadToken: Int
    let onLoadFailure: (String) -> Void
    let onLoaded: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(gateway: url, onLoadFailure: onLoadFailure, onLoaded: onLoaded)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Persistent store: the device token cookie survives app restarts.
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "EmdashMobile"

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.08, green: 0.07, blue: 0.18, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive

        let refresh = UIRefreshControl()
        refresh.addTarget(
            context.coordinator,
            action: #selector(Coordinator.refresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refresh
        context.coordinator.webView = webView
        context.coordinator.lastReloadToken = reloadToken
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        if coordinator.gateway != url {
            coordinator.gateway = url
            webView.load(URLRequest(url: url))
        } else if coordinator.lastReloadToken != reloadToken {
            coordinator.lastReloadToken = reloadToken
            if webView.url == nil {
                webView.load(URLRequest(url: url))
            } else {
                webView.reload()
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var gateway: URL
        var lastReloadToken = 0
        weak var webView: WKWebView?
        private let onLoadFailure: (String) -> Void
        private let onLoaded: () -> Void

        init(gateway: URL, onLoadFailure: @escaping (String) -> Void, onLoaded: @escaping () -> Void) {
            self.gateway = gateway
            self.onLoadFailure = onLoadFailure
            self.onLoaded = onLoaded
        }

        @objc func refresh(_ control: UIRefreshControl) {
            webView?.reload()
            control.endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction
        ) async -> WKNavigationActionPolicy {
            guard let target = navigationAction.request.url else { return .cancel }
            if target.scheme == "about" || GatewayAddress.isSameOrigin(target, as: gateway) {
                return .allow
            }
            if navigationAction.navigationType == .linkActivated,
               ["https", "http", "mailto"].contains(target.scheme?.lowercased() ?? "")
            {
                await UIApplication.shared.open(target)
            }
            return .cancel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onLoaded()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: any Error
        ) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            report(error)
        }

        private func report(_ error: any Error) {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
            onLoadFailure(Self.describe(nsError))
        }

        static func describe(_ error: NSError) -> String {
            switch (error.domain, error.code) {
            case (NSURLErrorDomain, NSURLErrorCannotFindHost),
                 (NSURLErrorDomain, NSURLErrorDNSLookupFailed):
                "Your Mac's tailnet name did not resolve. Is Tailscale connected on this iPhone?"
            case (NSURLErrorDomain, NSURLErrorCannotConnectToHost),
                 (NSURLErrorDomain, NSURLErrorTimedOut),
                 (NSURLErrorDomain, NSURLErrorNetworkConnectionLost):
                "Your Mac did not answer. Is it awake, with Emdash open and tailscale serve running?"
            case (NSURLErrorDomain, NSURLErrorNotConnectedToInternet):
                "This iPhone is offline."
            default:
                error.localizedDescription
            }
        }
    }
}
