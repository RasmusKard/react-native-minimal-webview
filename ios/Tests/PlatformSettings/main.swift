// PlatformSettings.swift on a real WKWebView: each coercion, the rejections and their reasons, the KVC guard, and
// get/call path resolution. Built as Mac Catalyst, so it runs on the Mac with no simulator (ios/Tests/run.sh).
// Not part of the pod (see the podspec). Catalyst's roots have no writable NSURL or NSNumber property to try.
import WebKit

var failures = 0
var cases = 0
func check(_ name: String, _ actual: Any?, _ expected: Any?) {
  cases += 1
  let (got, want) = (String(describing: actual ?? "nil"), String(describing: expected ?? "nil"))
  if got != want { failures += 1; print("FAIL \(name): expected \(want), got \(got)") }
}
func thrown(_ body: () throws -> Any) -> Any { do { return try body() } catch { return (error as? PlatformError)?.message ?? error } }
func code(_ body: () throws -> Any) -> String? { do { _ = try body(); return nil } catch { return (error as? PlatformError)?.code } }

let settings = PlatformSettings()
let configuration = WKWebViewConfiguration()
var webView: WKWebView?
/// Why `apply` rejects `root.key: value`, or nil: creating until `webView` is set, then live. A number meant to fit is
/// a Double, as the prop's JSONSerialization NSNumbers cast (a Swift Int in an Any doesn't cast to Double).
func reason(_ root: String, _ key: String, _ value: Any) -> String? {
  settings.apply([root: [key: value]], webView: webView, configuration: webView == nil ? configuration : nil).first?["reason"]
}
func rejects(_ root: String, _ key: String, _ value: Any, _ expected: String) { check("\(root).\(key) = \(value)", reason(root, key, value), expected) }
func sets(_ root: String, _ key: String, _ value: Any, _ read: @autoclosure () -> Any?, _ expected: Any?) {
  check("\(root).\(key) = \(value)", reason(root, key, value) ?? read(), expected)
}

sets("configuration", "suppressesIncrementalRendering", true, configuration.suppressesIncrementalRendering, true)
sets("configuration", "mediaTypesRequiringUserActionForPlayback", 1.5, configuration.mediaTypesRequiringUserActionForPlayback, WKAudiovisualMediaTypes.audio)
sets("configuration", "applicationNameForUserAgent", "Test", configuration.applicationNameForUserAgent, "Test")
sets("configuration", "websiteDataStore", "nonPersistent", configuration.websiteDataStore.isPersistent, false)
rejects("configuration", "websiteDataStore", "temporary", "a @\"WKWebsiteDataStore\" property can't take temporary")
rejects("configuration", "allowsInlineMediaPlayback", 1, "a B property can't take 1")
check("a live root while creating is skipped", reason("preferences", "minimumFontSize", 12.0), nil)
// react-native-webview's private key, by KVC as it sets it (no declared property).
sets("configuration", "allowUniversalAccessFromFileURLs", true, configuration.value(forKey: "allowUniversalAccessFromFileURLs") as? Bool, true)

let view = WKWebView(frame: .zero, configuration: configuration)
webView = view
sets("preferences", "minimumFontSize", 12.0, thrown { try settings.get("preferences.minimumFontSize", webView: view) }, "12")
rejects("preferences", "minimumFontSize", true, "a d property can't take true")
rejects("preferences", "minimumFontSize", "1", "a d property can't take 1")
rejects("preferences", "minimumFontSize", NSNull(), "a d property can't take <null>")
sets("webView", "customUserAgent", "UA", view.customUserAgent, "UA")
sets("webView", "customUserAgent", NSNull(), view.customUserAgent, "")
sets("webView", "underPageBackgroundColor", "#ff000080", view.underPageBackgroundColor.cgColor.components?.map { ($0 * 255).rounded() }, [255.0, 0, 0, 128])
rejects("webView", "underPageBackgroundColor", "red", "a @\"UIColor\" property can't take red")
sets("scrollView", "contentInset", ["top": 1.0, "left": 2, "bottom": 3, "right": 4], view.scrollView.contentInset, UIEdgeInsets(top: 1, left: 2, bottom: 3, right: 4))
rejects("scrollView", "contentInset", ["top": 1.0], "a {UIEdgeInsets=dddd} property can't take [\"top\": 1.0]")
sets("scrollView", "contentOffset", ["x": 5.0, "y": 6], view.scrollView.contentOffset, CGPoint(x: 5, y: 6))
sets("scrollView", "contentSize", ["width": 10.0, "height": 20], view.scrollView.contentSize, CGSize(width: 10, height: 20))
sets("webView", "accessibilityFrame", ["x": 1.0, "y": 2, "width": 3, "height": 4], view.accessibilityFrame, CGRect(x: 1, y: 2, width: 3, height: 4))
check("KVC guard: a setter's exception is the reason", reason("scrollView", "contentOffset", ["x": Double.nan, "y": 0])?.hasPrefix("CALayerInvalidGeometry:"), true)
rejects("preferences", "missing", 1, "no such property")
// The other private key, read back with get; the allowlist names a root's own keys, and no other private one.
sets("preferences", "allowFileAccessFromFileURLs", true, thrown { try settings.get("preferences.allowFileAccessFromFileURLs", webView: view) }, "true")
check("get reads the private configuration key", thrown { try settings.get("configuration.allowUniversalAccessFromFileURLs", webView: view) }, "true")
rejects("preferences", "allowUniversalAccessFromFileURLs", true, "no such property")
rejects("preferences", "developerExtrasEnabled", true, "no such property")
check("get refuses another private key", thrown { try settings.get("preferences.developerExtrasEnabled", webView: view) }, "no such property preferences.developerExtrasEnabled")
rejects("preferences", "_private", 1, "private and nested keys are not allowed")
rejects("webView", "scrollView.bounces", false, "private and nested keys are not allowed")
rejects("webView", "URL", "https://example.com", "read-only")
rejects("nope", "key", 1, "unknown root: use \(PlatformSettings.roots)")
check("a root that isn't an object", settings.apply(["preferences": 1], webView: view).first?["reason"], "not an object")
check("the configuration root live is skipped", reason("configuration", "suppressesIncrementalRendering", false), nil)
rejects("preferences", "minimumFontSize", "1", "a d property can't take 1")
check("a rejection is reported once", reason("preferences", "minimumFontSize", "1"), nil)

// A removed key goes back to its value before the first write; a configuration key stays (removing it recreates the
// WebView).
let removal = PlatformSettings()
let created = WKWebViewConfiguration()
_ = removal.apply(["configuration": ["suppressesIncrementalRendering": true]], webView: nil, configuration: created)
let fresh = WKWebView(frame: .zero, configuration: created)
let prefs = fresh.configuration.preferences
_ = removal.apply(["preferences": ["minimumFontSize": 12.0, "allowFileAccessFromFileURLs": true], "scrollView": ["bounces": false]], webView: fresh)
_ = removal.apply(["preferences": ["minimumFontSize": 16.0]], webView: fresh)
check("a removed root's key goes back", fresh.scrollView.bounces, true)
check("a removed private key goes back", prefs.value(forKey: "allowFileAccessFromFileURLs") as? Bool, false)
check("a key still there keeps its value", prefs.minimumFontSize, 16.0)
check("restoring reports nothing", removal.apply(["preferences": [:]], webView: fresh).count, 0)
check("to the value before the first write, not the last", prefs.minimumFontSize, 0.0)
check("a removed configuration key stays", fresh.configuration.suppressesIncrementalRendering, true)
_ = removal.apply(["preferences": ["minimumFontSize": 20.0]], webView: fresh)
_ = removal.apply([:], webView: fresh)
check("a key added again is captured again", prefs.minimumFontSize, 0.0)

check("get without a key", thrown { try settings.get("minimumFontSize", webView: view) }, "use root.key")
check("get on an unknown root", thrown { try settings.get("nope.key", webView: view) }, "unknown root: use \(PlatformSettings.roots)")
check("get an unknown key", thrown { try settings.get("webView.nope", webView: view) }, "no such property webView.nope")
check("get without a key is not_found", code { try settings.get("minimumFontSize", webView: view) }, "not_found")
check("get on an unknown root is not_found", code { try settings.get("nope.key", webView: view) }, "not_found")
check("get an unknown key is not_found", code { try settings.get("webView.nope", webView: view) }, "not_found")
check("call an unknown root is not_found", code { try settings.call("nope.reload", args: [], webView: view) { _, _ in } }, "not_found")
check("call an unknown selector", thrown { try settings.call("webView.nope:", args: [1.0], webView: view) { _, _ in } }, "WKWebView has no method nope:")
check("call an unknown selector is not_found", code { try settings.call("webView.nope:", args: [1.0], webView: view) { _, _ in } }, "not_found")
var result: String?
check("call", thrown { try settings.call("preferences.setMinimumFontSize:", args: [14.0], webView: view) { result = $0 ?? $1 } }, ())
check("call resolved", result, "null")
check("call set", view.configuration.preferences.minimumFontSize, 14.0)
check("call refused", thrown { try settings.call("webView.reload", args: [], webView: view) { _, _ in } }, "reload is owned by the core, or private")
check("a refused selector is native_error", code { try settings.call("webView.reload", args: [], webView: view) { _, _ in } }, "native_error")
check("call refuses a history restore", thrown { try settings.call("webView.setInteractionState:", args: [NSNull()], webView: view) { _, _ in } }, "setInteractionState: is owned by the core, or private")
/// A method per completion-handler shape the Swift tests can't get from WebKit without a page load.
final class Completions: NSObject {
  @objc func reportCount(_ handler: @escaping (Int) -> Void) { handler(3) }
  @objc func fail(_ handler: @escaping (NSError?) -> Void) { handler(NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "nope"])) }
}
/// What MRWInvoke settled with: the error, else the result.
func invoke(_ selector: Selector, _ completion: String?) -> String? {
  var settled: String?
  __MRWInvoke(Completions(), selector, [], completion) { value, error in settled = error ?? value.map { "\($0)" } }
  return settled
}
check("a number completion resolves the integer", invoke(#selector(Completions.reportCount(_:)), "number"), "3")
check("an error completion rejects with its description", invoke(#selector(Completions.fail(_:)), "error"), "nope")
check("a block selector without a shape rejects", invoke(#selector(Completions.reportCount(_:)), nil), "the method takes a completion handler this package's SDK headers don't list: write a native hook")
check("the completion table has the shape of a WebKit selector", platformCompletions["webView.evaluateJavaScript:completionHandler:"], "valueError")
check("NaN as JSON throws", (thrown { try PlatformSettings.json { Double.nan } } as? String)?.hasPrefix("NSInvalidArgumentException:"), true)
print("\(cases - failures)/\(cases) platform settings cases pass")
exit(failures == 0 ? 0 : 1)
