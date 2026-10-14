import ObjectiveC
import UIKit
import WebKit

/// The `ios` settings prop, `{ configuration: {…}, preferences: {…}, webpagePreferences: {…}, webView: {…},
/// scrollView: {…} }`, applied by Objective-C property name through Key-Value Coding, so a public property this
/// package doesn't know (one a newer WebKit adds) needs no code here. `configuration` is read once, when the WKWebView
/// is created; the other roots apply live, to `webView.configuration.preferences`,
/// `webView.configuration.defaultWebpagePreferences`, the WKWebView and its scroll view.
///
/// A value must fit the property's type: BOOL; integers, enums and option sets by raw value; floats; NSString; NSURL
/// from a string; UIColor from `#rrggbb` or `#rrggbbaa`; UIEdgeInsets, CGPoint, CGSize and CGRect from an object; and
/// `websiteDataStore` from `"default"` or `"nonPersistent"`. Anything else is rejected before KVC runs: a wrong value
/// in an object-typed property can take the process down (WebKit asserts), and an unknown key raises an Objective-C
/// exception Swift can't catch. Underscore (private) properties are refused.
final class PlatformSettings {
  /// "root.key" -> the last value applied or rejected, so an unchanged value is neither applied nor reported again.
  private var applied: [String: NSObject] = [:]

  /// Applies `settings`. While creating (`configuration` given, no WebView yet) only the `configuration` root applies;
  /// live, every other root does, and a changed `configuration` key is reported once. Returns the rejected keys.
  func apply(_ settings: [String: Any], webView: WKWebView?, configuration: WKWebViewConfiguration? = nil) -> [[String: String]] {
    var rejected: [[String: String]] = []
    let creating = configuration != nil
    for (rootName, entries) in settings {
      guard let entries = entries as? [String: Any] else {
        rejected.append(["key": rootName, "reason": "not an object"])
        continue
      }
      let isConfiguration = rootName == "configuration"
      // Each key applies in one phase: configuration keys while creating, the rest live.
      guard isConfiguration || !creating else { continue }
      for (key, value) in entries {
        let id = "\(rootName).\(key)"
        let boxed = value as? NSObject ?? NSNull()
        if applied[id] == boxed { continue }
        applied[id] = boxed
        if isConfiguration, !creating {
          rejected.append(["key": id, "reason": "read once when the WebView is created; remount with a new key to change it"])
          continue
        }
        guard let object = root(rootName, webView: webView, configuration: configuration) else {
          rejected.append(["key": id, "reason": "unknown root: use configuration, preferences, webpagePreferences, webView or scrollView"])
          continue
        }
        if let reason = set(object, key, value) { rejected.append(["key": id, "reason": reason]) }
      }
    }
    return rejected
  }

  /// `root.key` through KVC, as JSON. Throws an `EvaluateError`-like reason when it can't.
  func get(_ path: String, webView: WKWebView) throws -> String {
    guard let dot = path.firstIndex(of: ".") else { throw PlatformError("use root.key") }
    let rootName = String(path[..<dot])
    let key = String(path[path.index(after: dot)...])
    guard let object = root(rootName, webView: webView, configuration: webView.configuration) else {
      throw PlatformError("unknown root: use configuration, preferences, webpagePreferences, webView or scrollView")
    }
    guard !key.hasPrefix("_"), !key.contains("."), class_getProperty(type(of: object), key) != nil else {
      throw PlatformError("no such property \(path)")
    }
    let data = try JSONSerialization.data(withJSONObject: Self.jsonable(object.value(forKey: key)), options: .fragmentsAllowed)
    return String(decoding: data, as: UTF8.self)
  }

  private func root(_ name: String, webView: WKWebView?, configuration: WKWebViewConfiguration?) -> NSObject? {
    switch name {
    case "configuration": return configuration
    case "preferences": return webView?.configuration.preferences
    case "webpagePreferences": return webView?.configuration.defaultWebpagePreferences
    case "webView": return webView
    case "scrollView": return webView?.scrollView
    default: return nil
    }
  }

  /// Sets one property, or returns why not. The property's type encoding (`TB`, `TQ`, `T@"NSString"`,
  /// `T{UIEdgeInsets=dddd}`, …) decides what the value may be.
  private func set(_ object: NSObject, _ key: String, _ value: Any) -> String? {
    guard !key.hasPrefix("_"), !key.contains(".") else { return "private and nested keys are not allowed" }
    guard let property = class_getProperty(type(of: object), key) else { return "no such property" }
    let attributes = String(cString: property_getAttributes(property)!).split(separator: ",")
    guard let first = attributes.first, first.hasPrefix("T") else { return "no type" }
    if attributes.contains("R") { return "read-only" }
    let type = String(first.dropFirst())
    guard let coerced = Self.coerce(value, type) else { return "a \(type) property can't take \(value)" }
    return MRWCatchException { object.setValue(coerced is NSNull ? nil : coerced, forKey: key) }
  }

  /// `value` as KVC must get it for a property of type encoding `type`; NSNull stands for nil. Nil: doesn't fit.
  private static func coerce(_ value: Any, _ type: String) -> Any? {
    let isBool = CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID()
    let number = isBool ? nil : value as? NSNumber
    let string = value as? String
    let object = value as? [String: Any]
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
    case "{UIEdgeInsets=dddd}":
      guard let o = object, let t = o["top"] as? Double, let l = o["left"] as? Double, let b = o["bottom"] as? Double, let r = o["right"] as? Double else { return nil }
      return NSValue(uiEdgeInsets: UIEdgeInsets(top: t, left: l, bottom: b, right: r))
    case "{CGPoint=dd}":
      guard let o = object, let x = o["x"] as? Double, let y = o["y"] as? Double else { return nil }
      return NSValue(cgPoint: CGPoint(x: x, y: y))
    case "{CGSize=dd}":
      guard let o = object, let w = o["width"] as? Double, let h = o["height"] as? Double else { return nil }
      return NSValue(cgSize: CGSize(width: w, height: h))
    case "{CGRect={CGPoint=dd}{CGSize=dd}}":
      guard let o = object, let x = o["x"] as? Double, let y = o["y"] as? Double, let w = o["width"] as? Double, let h = o["height"] as? Double else { return nil }
      return NSValue(cgRect: CGRect(x: x, y: y, width: w, height: h))
    default:
      return nil
    }
  }

  /// `#rrggbb` or `#rrggbbaa`.
  private static func color(_ text: String) -> UIColor? {
    let hex = text.hasPrefix("#") ? String(text.dropFirst()) : text
    guard hex.count == 6 || hex.count == 8, let bits = UInt32(hex, radix: 16) else { return nil }
    let shift = hex.count == 8 ? bits : bits << 8 | 0xFF
    let part = { (offset: UInt32) in CGFloat((shift >> offset) & 0xFF) / 255 }
    return UIColor(red: part(24), green: part(16), blue: part(8), alpha: part(0))
  }

  /// A KVC value as JSON: numbers, strings, URLs, the four structs as objects, lists and objects of them; else null.
  private static func jsonable(_ value: Any?) -> Any {
    switch value {
    case nil, is NSNull: return NSNull()
    case let number as NSNumber: return number
    case let string as String: return string
    case let url as URL: return url.absoluteString
    case let array as [Any]: return array.map(jsonable)
    case let dictionary as [String: Any]: return dictionary.mapValues(jsonable)
    case let value as NSValue:
      switch String(cString: value.objCType) {
      case "{UIEdgeInsets=dddd}":
        let i = value.uiEdgeInsetsValue
        return ["top": i.top, "left": i.left, "bottom": i.bottom, "right": i.right]
      case "{CGPoint=dd}": return ["x": value.cgPointValue.x, "y": value.cgPointValue.y]
      case "{CGSize=dd}": return ["width": value.cgSizeValue.width, "height": value.cgSizeValue.height]
      case "{CGRect={CGPoint=dd}{CGSize=dd}}":
        let r = value.cgRectValue
        return ["x": r.origin.x, "y": r.origin.y, "width": r.width, "height": r.height]
      default: return NSNull()
      }
    default: return NSNull()
    }
  }
}

struct PlatformError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}
