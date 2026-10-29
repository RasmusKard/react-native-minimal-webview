// Runs the shared navigation, origin rule and crash recovery cases against NavigationRules.swift, OriginRules.swift
// and Recovery.swift, the DelegateProxy routing, the DocumentScope dispatch cases and the Asks contract. Not part of the pod (see the podspec).
//   xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Asks.swift \
//     ios/Recovery.swift ios/DelegateProxy.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules
import Foundation
import WebKit

func fail(_ message: String) -> Never {
  print("ERROR \(message)")
  exit(2)
}

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ios/Tests/vectors/navigation-rules.json"
guard let data = FileManager.default.contents(atPath: path),
  let vectors = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
  let rulesets = vectors["rulesets"] as? [String: [[String: Any]]],
  let cases = vectors["cases"] as? [[String: Any]],
  let answers = vectors["answers"] as? [[String: Any]]
else { fail("cannot read \(path)") }

var failures = 0
for testCase in cases {
  guard let name = testCase["name"] as? String,
    let request = testCase["request"] as? [String: Any],
    let url = request["url"] as? String,
    let expect = testCase["expect"] as? [String: Any],
    let action = expect["action"] as? String
  else { fail("malformed case \(testCase)") }
  let decision = NavigationRules.decide(
    (testCase["rules"] as? String).flatMap { rulesets[$0] },
    NavigationRules.Request(
      url: url,
      mainFrame: request["mainFrame"] as? Bool ?? true,
      newWindow: request["newWindow"] as? Bool ?? false,
      userInitiated: request["userInitiated"] as? Bool ?? false
    ),
    asked: Set(request["asked"] as? [String] ?? []),
    canAsk: request["canAsk"] as? Bool ?? true
  )
  let expected = NavigationRules.Decision(action: action, rule: expect["rule"] as? Int)
  if decision != expected {
    failures += 1
    print("FAIL \(name): expected \(expected), got \(decision)")
  }
}
for entry in answers {
  guard let expected = entry["action"] as? String else { fail("malformed answer \(entry)") }
  let actual = NavigationRules.answer(entry["answer"])
  if actual != expected {
    failures += 1
    print("FAIL answer \(entry["answer"] ?? "missing"): expected \(expected), got \(actual)")
  }
}
print("\(cases.count + answers.count - failures)/\(cases.count + answers.count) navigation rule cases pass")

let originPath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "ios/Tests/vectors/origin-rules.json"
guard let originData = FileManager.default.contents(atPath: originPath),
  let originCases = ((try? JSONSerialization.jsonObject(with: originData)) as? [String: Any])?["cases"] as? [[String: Any]]
else { fail("cannot read \(originPath)") }

var originFailures = 0
for testCase in originCases {
  guard let name = testCase["name"] as? String, let rules = testCase["rules"] as? [String],
    let origin = testCase["origin"] as? String, let allowed = testCase["allowed"] as? Bool
  else { fail("malformed case \(testCase)") }
  if OriginRules.allows(rules, origin) != allowed {
    originFailures += 1
    print("FAIL \(name): expected allowed \(allowed)")
  }
}
for (scheme, host, port, expected) in [
  ("https", "example.com", 0, "https://example.com"), ("https", "example.com", 443, "https://example.com"),
  ("http", "localhost", 8090, "http://localhost:8090"), ("http", "::1", 8090, "http://[::1]:8090"),
  ("http", "[::1]", 80, "http://[::1]"),
] where OriginRules.origin(scheme, host, port) != expected {
  originFailures += 1
  print("FAIL origin(\(scheme), \(host), \(port)): expected \(expected), got \(OriginRules.origin(scheme, host, port))")
}
print("\(originCases.count - originFailures)/\(originCases.count) origin rule cases pass")

// DocumentScope: every registrant hears each end once, in registration order; one added after an end hears the next.
var scopeFailures = 0
let scope = DocumentScope()
var heard: [String] = []
scope.register { heard.append("a:\($0)") }
scope.register { heard.append("b:\($0)") }
scope.end(.committed)
scope.end(.crashed)
if heard != ["a:committed", "b:committed", "a:crashed", "b:crashed"] {
  scopeFailures += 1
  print("FAIL document scope order: \(heard)")
}
var late: [DocumentScope.End] = []
scope.register { late.append($0) }
scope.end(.closing)
if late != [.closing] {
  scopeFailures += 1
  print("FAIL document scope late registrant: \(late)")
}
// A skipsOpening registrant doesn't hear the commit that opens a Document with none open: the first, or the one after
// a crash. Every other end, a crash or close with none open included, reaches it.
let opening = DocumentScope()
var skipped: [DocumentScope.End] = []
var plain: [DocumentScope.End] = []
opening.register(skipsOpening: true) { skipped.append($0) }
opening.register { plain.append($0) }
let openingEnds: [DocumentScope.End] = [.committed, .committed, .crashed, .crashed, .committed, .committed, .closing]
openingEnds.forEach(opening.end)
if skipped != [.committed, .crashed, .crashed, .committed, .closing] || plain != openingEnds {
  scopeFailures += 1
  print("FAIL document scope opening: \(skipped), \(plain)")
}
print("\(3 - scopeFailures)/3 document scope cases pass")

// Asks: each ask is answered once, by JS or with nil when native gives up; JS hears of a cancel except at closing.
var askFailures = 0
var sent: [[String: Any]] = []
var replies: [String?] = []
let asks = Asks { sent.append($0) }
func ask() -> Int { asks.ask("hook.q", ["a": 1]) { replies.append($0 as? String) } }
func cancelled() -> [Int] {
  sent.filter { $0["name"] as? String == "core.askCancelled" }.compactMap { ($0["payload"] as? [String: Any])?["askId"] as? Int }
}
let answered = ask()
asks.answer(answered, "yes")
asks.answer(answered, "late")
if replies != ["yes"] || sent.first?["name"] as? String != "hook.q" || sent.first?["askId"] as? Int != answered {
  askFailures += 1
  print("FAIL ask answered once: \(replies), \(sent)")
}
let timedOut = ask()
asks.cancel(timedOut)
asks.answer(timedOut, "late")
asks.cancel(timedOut)
if replies != ["yes", nil] || cancelled() != [timedOut] {
  askFailures += 1
  print("FAIL ask cancelled: \(replies), \(cancelled())")
}
let committed = ask()
asks.documentEnded(.committed)
let closing = ask()
asks.documentEnded(.closing)
asks.answer(closing, "late")
if replies != ["yes", nil, nil, nil] || cancelled() != [timedOut, committed] {
  askFailures += 1
  print("FAIL ask at a Document end: \(replies), \(cancelled())")
}
let before = sent.count
_ = ask()
if replies != ["yes", nil, nil, nil, nil] || sent.count != before {
  askFailures += 1
  print("FAIL ask after closing: \(replies), \(sent.count - before) sent")
}
print("\(4 - askFailures)/4 ask cases pass")

let recoveryPath = "ios/Tests/vectors/recovery.json"
guard let recoveryData = FileManager.default.contents(atPath: recoveryPath),
  let recovery = (try? JSONSerialization.jsonObject(with: recoveryData)) as? [String: Any],
  let sourceCases = recovery["source"] as? [[String: Any]],
  let guardCases = recovery["crashGuard"] as? [[String: Any]]
else { fail("cannot read \(recoveryPath)") }

var recoveryFailures = 0
for testCase in sourceCases {
  guard let name = testCase["name"] as? String, let uri = testCase["uri"] as? String,
    let url = testCase["url"] as? String, let shows = testCase["shows"] as? Bool
  else { fail("malformed case \(testCase)") }
  if Recovery.showsSource(uri, url) != shows {
    recoveryFailures += 1
    print("FAIL \(name): expected shows \(shows)")
  }
}
for testCase in guardCases {
  guard let name = testCase["name"] as? String, let crashes = testCase["crashes"] as? [[String: Any]] else {
    fail("malformed case \(testCase)")
  }
  var times: [Date] = []
  let reloads = crashes.map { crash in
    guard let at = crash["at"] as? Double else { fail("malformed crash \(crash)") }
    return Recovery.crashAllowsReload(&times, now: Date(timeIntervalSince1970: at / 1000))
  }
  let expected = crashes.compactMap { $0["reload"] as? Bool }
  if reloads != expected {
    recoveryFailures += 1
    print("FAIL \(name): expected reloads \(expected), got \(reloads)")
  }
}
let recoveryCount = sourceCases.count + guardCases.count
print("\(recoveryCount - recoveryFailures)/\(recoveryCount) recovery cases pass")

// DelegateProxy routing: each callback goes to the list of the protocol that declares it, and the action policy to the
// first navigation delegate with either variant. The WebKit objects are never touched by the fakes.
final class Core: NSObject, WKNavigationDelegate {
  @objc func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) { decisionHandler(.download) }
  @objc func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {}
}
final class PlainPolicy: NSObject, WKNavigationDelegate {
  @objc func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) { decisionHandler(.cancel) }
}
final class PreferencesPolicy: NSObject, WKNavigationDelegate {
  @objc func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) { decisionHandler(.allow, preferences) }
}
final class NavigationWithAlert: NSObject, WKNavigationDelegate {
  @objc func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {}
}
final class UIWithAlertAndPolicy: NSObject, WKUIDelegate {
  @objc func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {}
  @objc func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) { decisionHandler(.cancel) }
}

var proxyFailures = 0
var proxyCount = 0
func proxyCheck(_ name: String, _ ok: Bool) {
  proxyCount += 1
  if !ok {
    proxyFailures += 1
    print("FAIL proxy \(name)")
  }
}
let core = Core()
let webView = class_createInstance(WKWebView.self, 0) as! WKWebView
let navAction = class_createInstance(WKNavigationAction.self, 0) as! WKNavigationAction
let alertPanel = NSSelectorFromString("webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:")
func decided(_ proxy: DelegateProxy) -> WKNavigationActionPolicy? {
  var policy: WKNavigationActionPolicy?
  proxy.webView(webView, decidePolicyFor: navAction, preferences: WKWebpagePreferences()) { chosen, _ in policy = chosen }
  return policy
}
func proxy(_ navigation: [WKNavigationDelegate], _ ui: [WKUIDelegate] = []) -> DelegateProxy {
  let proxy = DelegateProxy(core: core)
  (proxy.navigationDelegates, proxy.uiDelegates) = (navigation, ui)
  return proxy
}
let plain = PlainPolicy()
let preferring = PreferencesPolicy()
proxyCheck("no hook: the core decides", decided(proxy([])) == .download)
proxyCheck("plain before preferences: plain decides", decided(proxy([plain, preferring])) == .cancel)
proxyCheck("preferences before plain: preferences decides", decided(proxy([preferring, plain])) == .allow)
proxyCheck("a UI delegate's action policy is ignored", decided(proxy([], [UIWithAlertAndPolicy()])) == .download)
proxyCheck("the proxy answers the preferences variant", proxy([]).responds(to: #selector(DelegateProxy.webView(_:decidePolicyFor:preferences:decisionHandler:))))
let uiAlert = UIWithAlertAndPolicy()
proxyCheck("an earlier UI delegate's alert beats a navigation delegate's", proxy([NavigationWithAlert()], [uiAlert]).forwardingTarget(for: alertPanel) as AnyObject? === uiAlert)
proxyCheck("a navigation delegate's alert is not an alert owner", proxy([NavigationWithAlert()]).forwardingTarget(for: alertPanel) as AnyObject? === core)
print("\(proxyCount - proxyFailures)/\(proxyCount) proxy cases pass")
exit(failures + originFailures + scopeFailures + askFailures + recoveryFailures + proxyFailures == 0 ? 0 : 1)
