import MinimalWebView
import QuartzCore
import WebKit

/// The `perf` suite's probe (example/perf.ts), in its own file, apart from the extension's sample hooks. It only
/// observes: `perfMark(i)` from the page stamps the moment before the page navigates to `…&i=<i>`, and
/// `didStartProvisionalNavigation` (which every hook delegate gets) the moment that navigation starts. It implements no
/// decision callback, so the core still decides every navigation. `ref.hook('sample.perf', 'drain')` hands the stamps
/// to JS and clears them.
enum PerfProbe {
  static func register() {
    MinimalWebViewHooks.register("sample.perf") { webView, context in
      let probe = Probe()
      webView.configuration.userContentController.add(probe, name: "perfMark")
      context.navigationDelegates.append(probe)
      context.handle("drain") { _, reply in reply(probe.drain()) }
      context.onDestroyed { [weak webView] _ in
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "perfMark")
      }
    }
  }
}

/// Main thread only: WebKit calls both on it, and so do the hook's handlers.
private final class Probe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  private var marks: [[String: Any]] = []

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    marks.append(["i": "\(message.body)", "markNs": now()])
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    let at = now()
    let i = webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
      .queryItems?.first { $0.name == "i" }?.value
    guard let i, let index = marks.lastIndex(where: { $0["i"] as? String == i && $0["goNs"] == nil }) else { return }
    marks[index]["goNs"] = at
  }

  func drain() -> [[String: Any]] {
    defer { marks.removeAll() }
    return marks
  }
}

/// A monotonic clock in ns, as a Double (exact below 2^53 ns, 104 days of uptime) so it crosses to JS as a number.
private func now() -> Double { Double(DispatchTime.now().uptimeNanoseconds) }

/// Main-thread frame gaps between `start` and `stop`, from a CADisplayLink: a main thread blocked for 300 ms shows as
/// one gap of about 300 ms.
final class Stall: NSObject {
  static let shared = Stall()
  private var link: CADisplayLink?
  private var last: CFTimeInterval = 0
  private var gaps: [Double] = []

  func start() {
    link?.invalidate()
    gaps = []
    last = 0
    link = CADisplayLink(target: self, selector: #selector(tick))
    link?.add(to: .main, forMode: .common)
  }

  @objc private func tick(_ link: CADisplayLink) {
    if last > 0 { gaps.append((link.timestamp - last) * 1000) }
    last = link.timestamp
  }

  func stop() -> [String: Any] {
    link?.invalidate()
    link = nil
    let sorted = gaps.sorted()
    return ["maxGapMs": sorted.last ?? 0, "medianGapMs": sorted.isEmpty ? 0 : sorted[sorted.count / 2], "frames": gaps.count]
  }
}
