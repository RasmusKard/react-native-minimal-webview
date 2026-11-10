// Runs the shared navigation, origin rule and crash recovery cases against NavigationRules.swift, OriginRules.swift
// and Recovery.swift, the DelegateProxy routing, the late hooks' order, the hookOptions changes a hook hears, the
// Asks contract, ReadAccess's roots, Loads' URL comparison and load ends and DownloadName. Not part of the pod (see the podspec).
// ios/Tests/run.sh builds and runs it.
import Foundation
import WebKit

func fail(_ message: String) -> Never {
  print("ERROR \(message)")
  exit(2)
}

var (total, failed) = (0, 0)
func check(_ name: String, _ ok: Bool) {
  total += 1
  if !ok {
    failed += 1
    print("FAIL \(name)")
  }
}

let path = "ios/Tests/vectors/navigation-rules.json"
guard let data = FileManager.default.contents(atPath: path),
  let vectors = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
  let rulesets = vectors["rulesets"] as? [String: [[String: Any]]],
  let cases = vectors["cases"] as? [[String: Any]],
  let answers = vectors["answers"] as? [[String: Any]]
else { fail("cannot read \(path)") }

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
  check("navigation \(name): expected \(expected), got \(decision)", decision == expected)
}
for entry in answers {
  guard let expected = entry["action"] as? String else { fail("malformed answer \(entry)") }
  let actual = NavigationRules.answer(entry["answer"])
  check("navigation answer \(entry["answer"] ?? "missing"): expected \(expected), got \(actual)", actual == expected)
}

let originPath = "ios/Tests/vectors/origin-rules.json"
guard let originData = FileManager.default.contents(atPath: originPath),
  let originCases = ((try? JSONSerialization.jsonObject(with: originData)) as? [String: Any])?["cases"] as? [[String: Any]]
else { fail("cannot read \(originPath)") }

for testCase in originCases {
  guard let name = testCase["name"] as? String, let rules = testCase["rules"] as? [String],
    let origin = testCase["origin"] as? String, let allowed = testCase["allowed"] as? Bool
  else { fail("malformed case \(testCase)") }
  check("origin \(name): expected allowed \(allowed)", OriginRules.allows(rules, origin) == allowed)
}
for (scheme, host, port, expected) in [
  ("https", "example.com", 0, "https://example.com"), ("https", "example.com", 443, "https://example.com"),
  ("http", "localhost", 8090, "http://localhost:8090"), ("http", "::1", 8090, "http://[::1]:8090"),
  ("http", "[::1]", 80, "http://[::1]"), ("", "", 0, "null"),
] {
  let got = OriginRules.origin(scheme, host, port)
  check("origin(\(scheme), \(host), \(port)): expected \(expected), got \(got)", got == expected)
}

// Asks: each ask is answered once, by JS or with nil when native gives up; JS hears of a cancel except at closing.
var sent: [[String: Any]] = []
var replies: [String?] = []
let asks = Asks { sent.append($0) }
func ask() -> Int { asks.ask("hook", "q", ["a": 1]) { replies.append($0 as? String) } }
func cancelled() -> [Int] {
  sent.filter { $0["key"] as? String == "core" && $0["name"] as? String == "askCancelled" }.compactMap { ($0["payload"] as? [String: Any])?["askId"] as? Int }
}
let answered = ask()
asks.answer(answered, "yes")
asks.answer(answered, "late")
check("ask answered once: \(replies), \(sent)", replies == ["yes"] && sent.first?["key"] as? String == "hook" && sent.first?["name"] as? String == "q" && sent.first?["askId"] as? Int == answered)
let timedOut = ask()
asks.cancel(timedOut)
asks.answer(timedOut, "late")
asks.cancel(timedOut)
check("ask cancelled: \(replies), \(cancelled())", replies == ["yes", nil] && cancelled() == [timedOut])
let committed = ask()
asks.documentEnded(.committed)
let closing = ask()
asks.documentEnded(.closing)
asks.answer(closing, "late")
check("ask at a Document end: \(replies), \(cancelled())", replies == ["yes", nil, nil, nil] && cancelled() == [timedOut, committed])
let before = sent.count
_ = ask()
check("ask after closing: \(replies), \(sent.count - before) sent", replies == ["yes", nil, nil, nil, nil] && sent.count == before)

let recoveryPath = "ios/Tests/vectors/recovery.json"
guard let recoveryData = FileManager.default.contents(atPath: recoveryPath),
  let recovery = (try? JSONSerialization.jsonObject(with: recoveryData)) as? [String: Any],
  let sourceCases = recovery["source"] as? [[String: Any]],
  let guardCases = recovery["crashGuard"] as? [[String: Any]]
else { fail("cannot read \(recoveryPath)") }

for testCase in sourceCases {
  guard let name = testCase["name"] as? String, let uri = testCase["uri"] as? String,
    let url = testCase["url"] as? String, let shows = testCase["shows"] as? Bool
  else { fail("malformed case \(testCase)") }
  check("recovery \(name): expected shows \(shows)", Recovery.showsSource(uri, url) == shows)
}
for testCase in guardCases {
  guard let name = testCase["name"] as? String, let crashes = testCase["crashes"] as? [[String: Any]] else {
    fail("malformed case \(testCase)")
  }
  var times: [TimeInterval] = []
  let reloads = crashes.map { crash in
    guard let at = crash["at"] as? Double else { fail("malformed crash \(crash)") }
    return Recovery.crashAllowsReload(&times, now: at / 1000)
  }
  let expected = crashes.compactMap { $0["reload"] as? Bool }
  check("recovery \(name): expected reloads \(expected), got \(reloads)", reloads == expected)
}

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
check("proxy no hook: the core decides", decided(proxy([])) == .download)
check("proxy plain before preferences: plain decides", decided(proxy([plain, preferring])) == .cancel)
check("proxy preferences before plain: preferences decides", decided(proxy([preferring, plain])) == .allow)
check("proxy a UI delegate's action policy is ignored", decided(proxy([], [UIWithAlertAndPolicy()])) == .download)
check("proxy the proxy answers the preferences variant", proxy([]).responds(to: #selector(DelegateProxy.webView(_:decidePolicyFor:preferences:decisionHandler:))))
let uiAlert = UIWithAlertAndPolicy()
check("proxy an earlier UI delegate's alert beats a navigation delegate's", proxy([NavigationWithAlert()], [uiAlert]).forwardingTarget(for: alertPanel) as AnyObject? === uiAlert)
check("proxy a navigation delegate's alert is not an alert owner", proxy([NavigationWithAlert()]).forwardingTarget(for: alertPanel) as AnyObject? === core)
final class Challenged: NSObject, WKNavigationDelegate {
  let answer: URLSession.AuthChallengeDisposition
  var calls = 0
  init(_ answer: URLSession.AuthChallengeDisposition) { self.answer = answer }
  @objc func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    calls += 1
    completionHandler(answer, nil)
  }
}
let challenge = class_createInstance(URLAuthenticationChallenge.self, 0) as! URLAuthenticationChallenge
func answered(_ delegates: [WKNavigationDelegate]) -> URLSession.AuthChallengeDisposition? {
  var answer: URLSession.AuthChallengeDisposition?
  proxy(delegates).webView(webView, didReceive: challenge) { disposition, _ in answer = disposition }
  return answer
}
check("proxy no hook: a challenge gets the default handling", answered([]) == .performDefaultHandling)
let trusting = Challenged(.useCredential)
check("proxy a default answer passes the challenge on", answered([Challenged(.performDefaultHandling), plain, trusting]) == .useCredential && trusting.calls == 1)
let later = Challenged(.useCredential)
check("proxy any other answer stands", answered([Challenged(.cancelAuthenticationChallenge), later]) == .cancelAuthenticationChallenge && later.calls == 0)
check("proxy nobody takes it: the default handling", answered([Challenged(.performDefaultHandling)]) == .performDefaultHandling)
check("proxy a decision two delegates implement is shared", proxy([], [uiAlert, UIWithAlertAndPolicy()]).sharedDecisions == [NSStringFromSelector(alertPanel)])
check("proxy either action policy variant counts", proxy([plain, preferring]).sharedDecisions == ["webView:decidePolicyForNavigationAction:decisionHandler:"])
check("proxy one delegate per decision, another list's or a challenge: none shared", proxy([NavigationWithAlert(), plain, Challenged(.useCredential), Challenged(.useCredential)], [uiAlert]).sharedDecisions.isEmpty)
let actionPolicyName = "webView:decidePolicyForNavigationAction:decisionHandler:"
check("proxy either action policy variant takes it from the props", [[plain], [preferring], [plain, preferring]].allSatisfy { proxy($0).takenDecisions.map(\.name) == [actionPolicyName] })
check("proxy it names what stops applying", proxy([plain]).takenDecisions.first?.lost == "navigationRules, their defaults and onNavigationRequest don't apply to navigations")
check("proxy a decision no prop makes, or a UI delegate's action policy: none taken", proxy([NavigationWithAlert()], [uiAlert]).takenDecisions.isEmpty)

let ordered = inRegistrationOrder(["typo", "c", "a", "b", "other"], ["b", "x", "a", "c"])
check("hook order: got \(ordered)", ordered == ["b", "a", "c", "other", "typo"])

// Only a change between two on values that are equal as JSON leaves the hook alone: false and 0 are equal to NSNumber.
let falsy = NSNumber(value: false)
let zero = NSNumber(value: 0)
let changeCases: [(String, Any?, Any?, Bool)] = [
  ("1 to 1", 1, 1, true), ("0 to 0", zero, zero, true), ("1 to 2", 1, 2, false),
  ("true to 1", true, NSNumber(value: 1), false), ("{a: false} to {a: 0}", ["a": falsy], ["a": zero], false),
  ("[true] to [1]", [true], [NSNumber(value: 1)], false), ("{a: 1, b: [true]} to itself", ["a": 1, "b": [true]], ["b": [true], "a": 1], true)
]
for (name, was, value, same) in changeCases { check("hookOptions change \(name)", staysOn(was, value) == same) }

// (name, file, readAccessRoot, the expected root, whether a warning)
let readCases: [(String, String, String?, String, Bool)] = [
  ("no root: the file's directory", "file:///a/site/index.html", nil, "file:///a/site/", false),
  ("the file's own directory", "file:///a/site/index.html", "file:///a/site/", "file:///a/site/", false),
  ("an ancestor", "file:///a/site/pages/index.html", "file:///a/", "file:///a/", false),
  ("no trailing slash", "file:///a/site/pages/index.html", "file:///a/site", "file:///a/site", false),
  ("the file itself", "file:///a/site/index.html", "file:///a/site/index.html", "file:///a/site/index.html", false),
  ("a sibling with the root's name as prefix", "file:///a/site2/index.html", "file:///a/site", "file:///a/site2/", true),
  ("a subdirectory, not an ancestor", "file:///a/site/index.html", "file:///a/site/pages/", "file:///a/site/", true),
  ("`..` out of the root", "file:///a/site/../other/index.html", "file:///a/site/", "file:///a/other/", true),
  ("an https: root", "file:///a/site/index.html", "https://example.com/", "file:///a/site/", true),
  ("a bare path", "file:///a/site/index.html", "/a/", "file:///a/site/", true),
  ("not a URL", "file:///a/site/index.html", "", "file:///a/site/", true),
]
for (name, file, root, expected, warns) in readCases {
  let access = ReadAccess.root(for: URL(string: file)!, root)
  // loadFileURL raises for a non-file read root: every result must be a file URL.
  check(
    "read root, \(name): got \(access.root.absoluteString), warning \(access.warning ?? "none")",
    access.root.isFileURL && access.root.standardizedFileURL == URL(string: expected)!.standardizedFileURL
      && (access.warning != nil) == warns)
}
// (a, b, whether they are the same URL as WebKit reports it): our own load is the navigation to its URL.
let sameURLCases: [(String, String, Bool)] = [
  ("https://example.com/x", "https://example.com/x", true),
  ("https://example.com", "https://example.com/", true),
  ("https://example.com?a=1", "https://example.com/?a=1", true),
  ("https://Example.COM/x", "https://example.com/x", true),
  ("HTTPS://example.com/x", "https://example.com/x", true),
  ("https://example.com:443/", "https://example.com/", true),
  ("http://example.com:80", "http://example.com/", true),
  ("https://Example.com:443", "https://example.com/", true),
  ("file:///a/index.html", "file:///a/index.html", true),
  ("https://example.com:8443/", "https://example.com/", false),
  ("http://example.com:443/", "http://example.com/", false),
  ("https://example.com/X", "https://example.com/x", false),
  ("https://example.com/x/", "https://example.com/x", false),
  ("https://example.com/?a=1", "https://example.com/?A=1", false),
  ("https://example.com/?", "https://example.com/", false),
  ("https://example.com/#a", "https://example.com/", false),
  ("https://User@example.com/", "https://user@example.com/", false),
  ("https://example.com/", "https://example.org/", false),
]
for (a, b, same) in sameURLCases {
  let (first, second) = (URL(string: a)!, URL(string: b)!)
  check("same URL, \(a) and \(b): expected \(same)", Loads.sameURL(first, second) == same && Loads.sameURL(second, first) == same)
}

// (domain, code, outcome, onError kind) of a main-frame load WebKit ends with an error.
let webKit = "WebKitErrorDomain"
func failed(_ codes: [Int], _ kind: String) -> [(String, Int, String, String?)] {
  codes.map { (NSURLErrorDomain, $0, "failed", kind) }
}
let endCases: [(String, Int, String, String?)] = [
  (NSURLErrorDomain, NSURLErrorCancelled, "cancelled", nil),
  (webKit, 102, "cancelled", nil), // frame load interrupted by a policy change
  (webKit, 204, "finished", nil), // plug-in will handle load: a media document
] + failed([
  NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateUntrusted,
  NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid,
  NSURLErrorClientCertificateRejected, NSURLErrorClientCertificateRequired,
], "ssl") + failed([
  NSURLErrorSecureConnectionFailed + 1, NSURLErrorClientCertificateRequired - 1, NSURLErrorNotConnectedToInternet,
  NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorAppTransportSecurityRequiresSecureConnection, 102, 204,
], "network") + [
  (webKit, 101, "failed", "network"), // cannot show URL: a scheme WebKit doesn't load
  (webKit, 103, "failed", "network"), // a restricted port
  (webKit, NSURLErrorCancelled, "failed", "network"),
  (webKit, NSURLErrorServerCertificateUntrusted, "failed", "network"),
  ("WKErrorDomain", 102, "failed", "network"),
]
for (domain, code, outcome, kind) in endCases {
  let end = Loads.ended(by: NSError(domain: domain, code: code))
  check("load end, \(domain) \(code): expected \(outcome) \(kind ?? "nil"), got \(end.outcome) \(end.kind ?? "nil")", end.outcome == outcome && end.kind == kind)
}
// (suggested name, the name saved): Android's DownloadsTest cases, and the `/` that guessFileName replaces there.
let nameCases: [(String, String)] = [
  (".", "download"), ("..", "download"), ("", "download"), ("...", "..."), ("a.txt", "a.txt"),
  ("a/b.txt", "a_b.txt"), ("../x", ".._x"), ("/", "_"), ("../..", ".._.."),
]
for (name, expected) in nameCases {
  check("download name \(name): expected \(expected), got \(DownloadName.safe(name))", DownloadName.safe(name) == expected)
}

print("\(total - failed)/\(total) cases pass")
exit(failed == 0 ? 0 : 1)
