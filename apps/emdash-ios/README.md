# Emdash Mobile — iOS shell

Native wrapper (SwiftUI + `WKWebView`) around the phone app the desktop serves under
Settings → Interface → Mobile access. Same screens as the Home Screen PWA, as an App Store /
TestFlight app: first launch asks for the Mac's tailnet address
(`https://<mac>.<tailnet>.ts.net:8443`), then pairing happens in the web app as usual. The
device token stays in the web view's HttpOnly cookie; native code never reads it.

- Only `https://*.ts.net` addresses are accepted, and navigation stays on that origin (other
  links open in Safari).
- Notifications: Web Push is not available inside `WKWebView`. Use the Home Screen PWA for
  notifications until APNs is wired (needs an APNs key from the developer account).

```bash
xcodegen generate            # the .xcodeproj is generated, never committed
xcodebuild test -scheme EmdashMobile -destination 'platform=iOS Simulator,name=iPhone 17'
scripts/archive.sh --upload  # TestFlight (needs the App Store Connect app record)
```
