import WebKit

var (total, failed) = (0, 0)
func check(_ name: String, _ ok: Bool) {
  total += 1
  if !ok {
    failed += 1
    print("FAIL \(name)")
  }
}

var destroyed: [DocumentEnd] = []
MainActor.assumeIsolated {
  MinimalWebViewHooks.register("teardown") { _, context in context.onDestroyed { destroyed.append($0) } }
  autoreleasepool {
    let view = MinimalWebView()
    view.hookOptions = ["teardown": true]
    view.applyProps()
  }
}
check("a view released without invalidate tears down: \(destroyed)", destroyed == [.closing])

print("\(total - failed)/\(total) view cases pass")
exit(failed == 0 ? 0 : 1)
