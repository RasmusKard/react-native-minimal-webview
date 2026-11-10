import Foundation

/// Crash recovery's choices that need no WebView, as on Android (`showsSource` and `crashAllowsReload` in
/// MinimalWebView.kt). Cases: src/__tests__/vectors/recovery.json.
enum Recovery {
  /// Whether the committed `url` is the page of the `source` with this `uri`: equal up to trailing slashes (WebKit
  /// commits `https://example.com` as `https://example.com/`). Not `Loads.sameURL`'s rule: that one picks out our own
  /// loads, which skip the navigation rules.
  static func showsSource(_ uri: String, _ url: String) -> Bool {
    func trimmed(_ url: String) -> String { url.replacingOccurrences(of: "/+$", with: "", options: .regularExpression) }
    return trimmed(uri) == trimmed(url)
  }

  /// Records a web content process death at `now`, in seconds of a clock the device time doesn't move
  /// (`ProcessInfo.systemUptime`), in `times` and says whether to reload after it: not after more than 3 in 60 s, a
  /// crash exactly 60 s back included.
  static func crashAllowsReload(_ times: inout [TimeInterval], now: TimeInterval) -> Bool {
    times = times.filter { now - $0 <= crashWindow } + [now]
    return times.count <= maxCrashesPerWindow
  }
}

// shortcut: a fixed crash-loop guard, make it a prop if an app needs a different policy
private let maxCrashesPerWindow = 3
private let crashWindow: TimeInterval = 60
