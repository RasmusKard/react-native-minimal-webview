import Foundation

/// Crash recovery's choices that need no WebView, as on Android (`showsSource` and `crashAllowsReload` in
/// MinimalWebView.kt). Cases: src/__tests__/vectors/recovery.json.
enum Recovery {
  /// Whether the committed `url` is the page of the `source` with this `uri`: the same `Loads.canonical` form up to
  /// trailing slashes.
  static func showsSource(_ uri: String, _ url: String) -> Bool {
    func page(_ url: String) -> String {
      (URL(string: url).map(Loads.canonical) ?? url).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    }
    return page(uri) == page(url)
  }

  /// Records a web content process death at `now` in `times`, and says whether to reload after it: not after more than
  /// `maxCrashesPerWindow` in `crashWindow`, a death exactly `crashWindow` back included. `now` is in seconds of
  /// `ProcessInfo.systemUptime`, which a change of device time doesn't move.
  static func crashAllowsReload(_ times: inout [TimeInterval], now: TimeInterval) -> Bool {
    times = times.filter { now - $0 <= crashWindow } + [now]
    return times.count <= maxCrashesPerWindow
  }
}

// shortcut: a fixed crash-loop guard, make it a prop if an app needs a different policy
private let maxCrashesPerWindow = 3
private let crashWindow: TimeInterval = 60
