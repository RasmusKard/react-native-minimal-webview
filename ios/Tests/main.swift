// Runs the shared navigation and origin rule cases against NavigationRules.swift and OriginRules.swift, and the
// DocumentScope dispatch cases. Not part of the pod (see the podspec).
//   xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Tests/main.swift \
//     -o /tmp/rules && /tmp/rules
import Foundation

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
print("\(2 - scopeFailures)/2 document scope cases pass")
exit(failures + originFailures + scopeFailures == 0 ? 0 : 1)
