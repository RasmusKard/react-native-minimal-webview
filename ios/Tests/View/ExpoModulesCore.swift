import UIKit

open class ExpoView: UIView {
  public required init(appContext: AppContext? = nil) {
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  public required init?(coder: NSCoder) { nil }
}

public final class AppContext {}

public final class EventDispatcher {
  public var onEventSent: (([String: Any]) -> Void)?

  public init() {}

  public func callAsFunction(_ payload: [String: Any]) {
    onEventSent?(payload)
  }
}

public struct Promise {
  public let resolve: (Any?) -> Void
  public let reject: (String, String) -> Void

  public func resolve(_ value: Any? = nil) { resolve(value) }
  public func reject(_ code: String, _ description: String) { reject(code, description) }
}

public protocol Record {
  init()
}

extension Record {
  public func toDictionary(appContext: AppContext? = nil) -> [String: Any] {
    Dictionary(uniqueKeysWithValues: Mirror(reflecting: self).children.compactMap { child in
      (child.value as? any FieldValue).map { (String(child.label?.dropFirst() ?? ""), $0.value) }
    })
  }
}

protocol FieldValue {
  var value: Any { get }
}

@propertyWrapper
public struct Field<T>: FieldValue {
  public var wrappedValue: T

  public init(wrappedValue: T) {
    self.wrappedValue = wrappedValue
  }

  var value: Any { wrappedValue }
}
