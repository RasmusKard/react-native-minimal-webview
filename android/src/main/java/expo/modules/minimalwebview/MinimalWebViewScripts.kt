package expo.modules.minimalwebview

import android.util.Log
import androidx.webkit.JavaScriptExecutionWorld
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.Promise

/** Scripts in the page: the bridge transport, `injectedScripts` and `evaluate`. */
internal class MinimalWebViewScripts(private val owner: MinimalWebView, private val onBridge: (Map<String, Any?>) -> Unit) {
  private val webView get() = owner.webView

  // The bridge as installed (script and origins), so a changed bridge prop can replace it.
  private var installedBridge: Pair<String?, List<String>?>? = null
  private var bridgeScriptHandler: ScriptHandler? = null
  // Bridge: the page posts through `window.nativeBridgeTransport`; replies go to the main frame's latest proxy.
  private var replyProxy: JavaScriptReplyProxy? = null
  private var installedScripts: List<Map<String, Any?>>? = null
  private val scriptHandlers = mutableListOf<ScriptHandler>()
  private val evaluations = mutableSetOf<Promise>()

  fun apply() {
    if (owner.bridgeScript to owner.bridgeOrigins != installedBridge) installBridge()
    installScripts()
  }

  /** A new WebView (after a crash) has nothing installed yet. */
  fun reinstall() {
    installedBridge = null
    bridgeScriptHandler = null
    installBridge()
    installScripts(force = true)
  }

  private fun installBridge() {
    if (installedBridge != null) {
      WebViewCompat.removeWebMessageListener(webView, "nativeBridgeTransport")
      bridgeScriptHandler?.remove()
      bridgeScriptHandler = null
      replyProxy = null
    }
    installedBridge = owner.bridgeScript to owner.bridgeOrigins
    val script = owner.bridgeScript ?: return
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)
    ) {
      onBridge(mapOf("unavailable" to true))
      return
    }
    val origins = owner.bridgeOrigins.orEmpty().toSet()
    // A malformed origin rule makes WebView throw; createBridge validates them, so this only guards against misuse.
    // JS learns of it: calls reject with `unavailable`.
    val installed = try {
      addBridge(script, origins)
      true
    } catch (e: IllegalArgumentException) {
      failed("bridge not installed: invalid allowedOrigins $origins", e)
    }
    if (!installed) onBridge(mapOf("unavailable" to true))
  }

  private fun addBridge(script: String, origins: Set<String>) {
    WebViewCompat.addWebMessageListener(webView, "nativeBridgeTransport", origins) { _, message, _, isMainFrame, proxy ->
      // Main frame only, like iOS. The origin rules already filtered the sender.
      if (!isMainFrame) return@addWebMessageListener
      replyProxy = proxy
      onBridge(mapOf("message" to message.data))
    }
    val pageWorld = WebViewCompat.getExecutionWorld(webView, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
    bridgeScriptHandler = WebViewCompat.addJavaScriptOnEvent(
      webView, script, WebViewCompat.INJECTION_EVENT_DOCUMENT_START, origins, pageWorld
    )
  }

  /** Changed scripts take effect from the next navigation. */
  private fun installScripts(force: Boolean = false) {
    val scripts = owner.injectedScripts.orEmpty()
    if (!force && scripts == installedScripts) return
    installedScripts = scripts
    scriptHandlers.forEach { it.remove() }
    scriptHandlers.clear()
    if (scripts.isEmpty()) return
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)) {
      Log.w(TAG, "injectedScripts need WebView 146+; update Android System WebView")
      return
    }
    val pageWorld = WebViewCompat.getExecutionWorld(webView, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
    for (script in scripts) {
      val code = script["code"] as? String ?: continue
      // No frame selector in androidx.webkit 1.17: main-frame-only scripts guard themselves.
      // A prefix, not a wrapping block: top-level const/let/class in the script must stay global.
      val source = if (script["mainFrameOnly"] == true) "if (window !== window.top) throw 0;\n$code" else code
      val event = if (script["when"] == "end") WebViewCompat.INJECTION_EVENT_DOCUMENT_END else WebViewCompat.INJECTION_EVENT_DOCUMENT_START
      scriptHandlers += WebViewCompat.addJavaScriptOnEvent(webView, source, event, setOf("*"), pageWorld)
    }
  }

  fun post(message: String) {
    replyProxy?.postMessage(message)
  }

  fun newDocument() {
    failEvaluations()
    // A new document: the old reply proxy is gone; JS queues bridge messages until the page is ready again.
    replyProxy = null
    if (installedBridge?.first != null) onBridge(mapOf("navigated" to true))
  }

  fun failPending() {
    replyProxy = null
    failEvaluations()
  }

  /** Runs a script in the page. WebView drops the callback when the document is replaced first, so a new document
   * rejects what is still waiting (as iOS does) instead of leaving the promise pending forever. */
  fun evaluate(script: String, promise: Promise) {
    evaluations += promise
    webView.evaluateJavascript(script) { if (evaluations.remove(promise)) promise.resolve(it) }
  }

  private fun failEvaluations() {
    val waiting = evaluations.toList()
    evaluations.clear()
    waiting.forEach { it.reject("navigated", "the page navigated before the script finished", null) }
  }
}
