import ObjectiveC
import UIKit
import WebKit

final class PlatformSettings {
  private var applied: [String: NSObject] = [:]
  private var originals: [String: Any] = [:]

  /// Applies `settings`. While creating (`configuration` given, no WebView yet) only the `configuration` root applies;
  /// live, every other root does, and a key applied before and missing now goes back to its value before the first
  /// write. Returns the rejected keys.
  func apply(_ settings: [String: Any], webView: WKWebView?, configuration: WKWebViewConfiguration? = nil) -> [[String: String]] {
    var rejected: [[String: String]] = []
    let creating = configuration != nil
    // Restoring a scroll view's inset can move its offset.
    if !creating { rejected += restore(removedFrom: settings, webView: webView) }
    for (rootName, entries) in settings {
      guard let entries = entries as? [String: Any] else {
        rejected.append(["key": rootName, "reason": "not an object"])
        continue
      }
      let isConfiguration = rootName == "configuration"
      guard isConfiguration == creating else { continue }
      for (key, value) in entries {
        let id = "\(rootName).\(key)"
        let boxed = value as? NSObject ?? NSNull()
        if applied[id] == boxed { continue }
        applied[id] = boxed
        guard let object = root(rootName, webView: webView, configuration: configuration) else {
          rejected.append(["key": id, "reason": "unknown root: use \(Self.roots)"])
          continue
        }
        if let reason = set(object, key, value, original: isConfiguration ? nil : id) {
          rejected.append(["key": id, "reason": reason])
        }
      }
    }
    return rejected
  }

  /// Forgets each applied key `settings` no longer has and sets its original value back; returns those that failed.
  private func restore(removedFrom settings: [String: Any], webView: WKWebView?) -> [[String: String]] {
    var present = Set<String>()
    for (rootName, entries) in settings {
      guard let entries = entries as? [String: Any] else { continue }
      present.formUnion(entries.keys.map { "\(rootName).\($0)" })
    }
    var failed: [[String: String]] = []
    for id in applied.keys where !present.contains(id) {
      applied[id] = nil
      guard let original = originals.removeValue(forKey: id), let dot = id.firstIndex(of: "."),
        let object = root(String(id[..<dot]), webView: webView, configuration: nil) else { continue }
      let key = String(id[id.index(after: dot)...])
      if let reason = __MRWCatchException({ object.setValue(original is NSNull ? nil : original, forKey: key) }) {
        failed.append(["key": id, "reason": "removed, but restoring it failed: \(reason)"])
      }
    }
    return failed
  }

  /// `root.key` through KVC, as JSON. Throws a `PlatformError` with the reason when it can't.
  func get(_ path: String, webView: WKWebView) throws -> String {
    guard let dot = path.firstIndex(of: ".") else { throw PlatformError("use root.key", code: "not_found") }
    let rootName = String(path[..<dot])
    let key = String(path[path.index(after: dot)...])
    guard let object = root(rootName, webView: webView, configuration: webView.configuration) else {
      throw PlatformError("unknown root: use \(Self.roots)", code: "not_found")
    }
    guard !key.hasPrefix("_"), !key.contains("."), Self.attributes(object, key) != nil else {
      throw PlatformError("no such property \(path)", code: "not_found")
    }
    return try Self.json { __MRWJsonable(object.value(forKey: key)) }
  }

  /// `root.selector:` with the JSON `args`, resolved with the result as JSON, or with why it couldn't be called.
  func call(_ path: String, args: [Any], webView: WKWebView, resolve: @escaping (String?, String?) -> Void) throws {
    guard let dot = path.lastIndex(of: ".") else { throw PlatformError("use root.selector:", code: "not_found") }
    let selector = String(path[path.index(after: dot)...])
    guard let object = root(String(path[..<dot]), webView: webView, configuration: webView.configuration) else {
      throw PlatformError("unknown root: use \(Self.roots)", code: "not_found")
    }
    guard !Self.refused.contains(where: selector.hasPrefix) else {
      throw PlatformError("\(selector) is owned by the core, or private")
    }
    guard object.responds(to: NSSelectorFromString(selector)) else {
      throw PlatformError("\(type(of: object)) has no method \(selector)", code: "not_found")
    }
    __MRWInvoke(object, NSSelectorFromString(selector), args, platformCompletions[path]) { result, error in
      guard error == nil, let result else { return resolve(nil, error ?? "the result is not JSON") }
      do {
        let json = try Self.json { result }
        resolve(json, nil)
      } catch let failure {
        resolve(nil, (failure as? PlatformError)?.message ?? failure.localizedDescription)
      }
    }
  }

  /// `value()` as JSON text. It runs inside MRWCatchException: a getter that raises, or a NaN that JSONSerialization
  /// raises for, throws here instead of crashing the app.
  static func json(_ value: () -> Any) throws -> String {
    var data: Data?
    let raised = __MRWCatchException {
      data = try? JSONSerialization.data(withJSONObject: value(), options: .fragmentsAllowed)
    }
    if let raised { throw PlatformError(raised) }
    guard let data else { throw PlatformError("the result is not JSON") }
    return String(decoding: data, as: UTF8.self)
  }

  /// KVC, KVO and performSelector reach any selector; `init`, `copy`, `new` and `mutableCopy` return a +1 object
  /// MRWInvoke would leak.
  private static let refused = [
    "_", "load", "go", "reload", "stop", "evaluateJavaScript", "callAsyncJavaScript", "startDownload", "resumeDownload",
    "setInteractionState", "setNavigationDelegate", "setUIDelegate", "setDelegate", "setValue", "setValuesForKeys", "valueForKey",
    "dictionaryWithValuesForKeys", "mutable", "willChange", "didChange", "performSelector", "init", "copy", "new",
    "retain", "release", "autorelease", "dealloc",
  ]
  static let roots = "configuration, preferences, webpagePreferences, webView, scrollView, websiteDataStore or httpCookieStore"

  private func root(_ name: String, webView: WKWebView?, configuration: WKWebViewConfiguration?) -> NSObject? {
    switch name {
    case "configuration": return configuration
    case "preferences": return webView?.configuration.preferences
    case "webpagePreferences": return webView?.configuration.defaultWebpagePreferences
    case "webView": return webView
    case "scrollView": return webView?.scrollView
    case "websiteDataStore": return webView?.configuration.websiteDataStore
    case "httpCookieStore": return webView?.configuration.websiteDataStore.httpCookieStore
    default: return nil
    }
  }

  /// Sets one property, or returns why not; with `original`, first keeps the value it replaces under that id unless one
  /// is kept already.
  private func set(_ object: NSObject, _ key: String, _ value: Any, original id: String?) -> String? {
    guard !key.hasPrefix("_"), !key.contains(".") else { return "private and nested keys are not allowed" }
    guard let attributes = Self.attributes(object, key) else { return "no such property" }
    guard let first = attributes.first, first.hasPrefix("T") else { return "no type" }
    if attributes.contains("R") { return "read-only" }
    let type = String(first.dropFirst())
    guard let coerced = Self.coerce(value, type) else { return "a \(type) property can't take \(value)" }
    return __MRWCatchException {
      if let id, originals[id] == nil { originals[id] = object.value(forKey: key) ?? NSNull() }
      object.setValue(coerced is NSNull ? nil : coerced, forKey: key)
    }
  }

  /// The attributes of `object`'s property `key` (`TB`, `R`, …), or nil when it has none.
  private static func attributes(_ object: NSObject, _ key: String) -> [Substring]? {
    if privateBools[key].map({ object.isKind(of: $0) }) == true { return ["TB"] }
    guard let property = class_getProperty(type(of: object), key) else { return nil }
    return String(cString: property_getAttributes(property)!).split(separator: ",")
  }

  /// KVC reaches these through WebKit's `_set…` accessors: WebKit declares no property by these names.
  private static let privateBools: [String: AnyClass] = [
    "allowFileAccessFromFileURLs": WKPreferences.self,
    "allowUniversalAccessFromFileURLs": WKWebViewConfiguration.self,
  ]

  /// `value` as KVC must get it for a property of type encoding `type`; NSNull stands for nil. Nil: doesn't fit. A value
  /// of the wrong class in an object-typed property can take the process down (WebKit asserts).
  private static func coerce(_ value: Any, _ type: String) -> Any? {
    let isBool = CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID()
    let number = isBool ? nil : value as? NSNumber
    let string = value as? String
    let isNull = value is NSNull
    switch type {
    case "B", "c":
      return isBool ? value : nil
    case "s", "S", "i", "I", "l", "L", "q", "Q", "f", "d":
      return number
    case "@\"NSString\"":
      return string ?? (isNull ? NSNull() : nil)
    case "@\"NSURL\"":
      return string.flatMap { URL(string: $0) as NSURL? } ?? (isNull ? NSNull() : nil)
    case "@\"NSNumber\"":
      return number ?? (isNull ? NSNull() : nil)
    case "@\"UIColor\"":
      return string.flatMap(color) ?? (isNull ? NSNull() : nil)
    case "@\"WKWebsiteDataStore\"":
      switch string {
      case "default": return WKWebsiteDataStore.default()
      case "nonPersistent": return WKWebsiteDataStore.nonPersistent()
      default: return nil
      }
    case _ where type.hasPrefix("{"):
      return __MRWStructValue(type, value)
    default:
      return nil
    }
  }

  private static func color(_ text: String) -> UIColor? {
    let hex = text.hasPrefix("#") ? String(text.dropFirst()) : text
    guard hex.count == 6 || hex.count == 8, let bits = UInt32(hex, radix: 16) else { return nil }
    let rgba = hex.count == 8 ? bits : bits << 8 | 0xFF
    let part = { (offset: UInt32) in CGFloat((rgba >> offset) & 0xFF) / 255 }
    return UIColor(red: part(24), green: part(16), blue: part(8), alpha: part(0))
  }
}

/// Why `get` or `call` failed; `code` is the JS error code (`not_found` or `native_error`).
struct PlatformError: Error {
  let message: String
  let code: String
  init(_ message: String, code: String = "native_error") {
    self.message = message
    self.code = code
  }
}
