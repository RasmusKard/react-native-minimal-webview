import Foundation

enum Recovery {
  static func showsSource(_ uri: String, _ url: String) -> Bool {
    func page(_ url: String) -> String {
      (URL(string: url).map(Loads.canonical) ?? url).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    }
    return page(uri) == page(url)
  }

  /// Records a web content process death at `now`, in seconds of `ProcessInfo.systemUptime`, in `times`, and says
  /// whether to reload after it.
  static func crashAllowsReload(_ times: inout [TimeInterval], now: TimeInterval) -> Bool {
    times = times.filter { now - $0 <= crashWindow } + [now]
    return times.count <= maxCrashesPerWindow
  }
}

private let maxCrashesPerWindow = 3
private let crashWindow: TimeInterval = 60
