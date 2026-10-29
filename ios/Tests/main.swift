// Runs the shared navigation, origin rule and crash recovery cases against NavigationRules.swift, OriginRules.swift
// and Recovery.swift, the DocumentScope dispatch cases, the Asks contract and ReadAccess's roots. Not part of the pod
// (see the podspec).
//   xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Asks.swift \
//     ios/Recovery.swift ios/ReadAccess.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules
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
var readFailures = 0
for (name, file, root, expected, warns) in readCases {
  let access = ReadAccess.root(for: URL(string: file)!, root)
  // loadFileURL raises for a non-file read root: every result must be a file URL.
  if !access.root.isFileURL || access.root.standardizedFileURL != URL(string: expected)!.standardizedFileURL
    || (access.warning != nil) != warns {
    readFailures += 1
    print("FAIL read root, \(name): got \(access.root.absoluteString), warning \(access.warning ?? "none")")
  }
}
print("\(readCases.count - readFailures)/\(readCases.count) read root cases pass")
exit(failures + originFailures + scopeFailures + askFailures + recoveryFailures + readFailures == 0 ? 0 : 1)
