import WebKit

var (total, failed) = (0, 0)
func check(_ name: String, _ ok: Bool) {
  total += 1
  if !ok {
    failed += 1
    print("FAIL \(name)")
  }
}

var teardown: [String] = []
func released(_ options: String) -> [String] {
  teardown = []
  MainActor.assumeIsolated {
    autoreleasepool {
      let view = MinimalWebView()
      view.hookOptions = ["teardown": options]
      view.applyProps()
    }
  }
  return teardown
}
MainActor.assumeIsolated {
  MinimalWebViewHooks.register("teardown") { _, context in
    if context.options as? String == "ask" { context.ask("question", [:]) { teardown.append("answered \($0 as Any)") } }
    context.onDocumentEnd { teardown.append("documentEnd \($0)") }
    context.onDestroyed { teardown.append("destroyed \($0)") }
  }
}
let quiet = released("quiet")
check("a view released without invalidate ends its Document and tears down: \(quiet)", quiet == ["documentEnd closing", "destroyed closing"])
let asked = released("ask")
check(
  "a view whose hook asked, released without invalidate, answers the ask and tears down: \(asked)",
  asked == ["answered nil", "documentEnd closing", "destroyed closing"])

print("\(total - failed)/\(total) view cases pass")
exit(failed == 0 ? 0 : 1)
