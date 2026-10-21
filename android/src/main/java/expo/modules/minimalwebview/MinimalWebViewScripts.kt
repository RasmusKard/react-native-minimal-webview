package expo.modules.minimalwebview

import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.minimalwebview.DocumentScope.End
import org.json.JSONArray

/** Scripts in the page: the bridge transport, `injectedScripts` and `evaluate`. */
internal class MinimalWebViewScripts(private val owner: MinimalWebView, private val onBridge: (Map<String, Any?>) -> Unit) {
  private val webView get() = owner.webView

  // Bridge: the page posts through `window.nativeBridgeTransport`; replies go to the main frame's latest proxy.
  private var replyProxy: JavaScriptReplyProxy? = null
  private var installedScripts: List<InjectedScript>? = null
  private val scriptHandlers = mutableListOf<ScriptHandler>()
  private val evaluations = mutableMapOf<Int, (Result<String>) -> Unit>()
  private var nextEvaluation = 0
  private var installed = false

  /** The evaluate channel and the bridge go in once, from the first props: JS fixes `bridge` at mount. */
  fun apply() {
    if (!installed) {
      installed = true
      installEvaluate()
      installBridge()
    }
    installScripts()
  }

  /** A new WebView (after a crash) has nothing installed yet. */
  fun reinstall() {
    installEvaluate()
    installBridge()
    installScripts(force = true)
  }

  private fun installBridge() {
    val script = owner.bridgeScript ?: return
    val bridgeFeatures = listOf(WebViewFeature.WEB_MESSAGE_LISTENER, WebViewFeature.DOCUMENT_START_SCRIPT)
    if (lacks("bridge", bridgeFeatures, "bridge calls reject with `unavailable`")) {
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
    // Runs before the page's own scripts, after the transport object exists.
    WebViewCompat.addDocumentStartJavaScript(webView, script, origins)
  }

  /** Changed scripts take effect from the next navigation. */
  private fun installScripts(force: Boolean = false) {
    val scripts = owner.injectedScripts.orEmpty()
    if (!force && scripts == installedScripts) return
    installedScripts = scripts
    scriptHandlers.forEach { it.remove() }
    scriptHandlers.clear()
    if (scripts.isEmpty() || lacks("injectedScripts", listOf(WebViewFeature.DOCUMENT_START_SCRIPT), "injected scripts don't run")) return
    for (script in scripts) {
      val code = script.code ?: continue
      // No frame selector in androidx.webkit 1.17: main-frame-only scripts guard themselves.
      // A prefix, not a wrapping block: top-level const/let/class in the script must stay global.
      val source = if (script.mainFrameOnly != false) "if (window !== window.top) throw 0;\n$code" else code
      scriptHandlers += WebViewCompat.addDocumentStartJavaScript(webView, source, setOf("*"))
    }
  }

  fun post(message: String) {
    replyProxy?.postMessage(message)
  }

  /** The Document ended: its evaluations fail and its reply proxy is gone. JS queues bridge messages until the next
   * page is ready; at unmount it rejects what is in flight itself. */
  fun documentEnded(reason: End) {
    failEvaluations()
    replyProxy = null
    if (reason != End.CLOSING && owner.bridgeScript != null) onBridge(mapOf("navigated" to true))
  }

  /** `evaluate` results come back through one global in every frame (`*`, before the first document); only the main
   * frame's replies count. A page can forge them, as it can already shape any value its own world returns. */
  private fun installEvaluate() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    WebViewCompat.addWebMessageListener(webView, EVALUATE, setOf("*")) { _, message, _, isMainFrame, _ ->
      val reply = if (isMainFrame) runCatching { JSONArray(message.data) }.getOrNull() else null
      val onResult = reply?.let { evaluations.remove(it.optInt(0, -1)) } ?: return@addWebMessageListener
      onResult(if (reply.length() > 2) failure("ERR_EVALUATE", reply.optString(2)) else Result.success(reply.optString(1, "null")))
    }
  }

  /** Runs an expression in the page and awaits it, as iOS does; resolves with its JSON ("null" for what JSON can't
   * encode). WebView drops the callback when the document is replaced first, so a new document rejects what is still
   * waiting instead of leaving it pending forever. A failure is an [EvaluateError]. */
  fun evaluate(script: String, onResult: (Result<String>) -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      return onResult(failure("unavailable", "evaluate needs WEB_MESSAGE_LISTENER; update Android System WebView"))
    }
    val id = nextEvaluation++
    evaluations[id] = onResult
    // The script sits in a scope of its own (no wrapper names shadow the page's); the sync value is 1 once it started.
    val code = """typeof $EVALUATE === 'object' ? ((t, p) => (p.then(
  (v) => { try { v = JSON.stringify(v) } catch { v = null } t.postMessage(JSON.stringify([$id, v ?? 'null'])) },
  (e) => { try { e = String(e) } catch { e = 'Error' } t.postMessage(JSON.stringify([$id, null, e])) }
), 1))($EVALUATE, (async () => (
$script
))()) : 0"""
    webView.evaluateJavascript(code) {
      // 0: the page has no channel (it loaded before the listener); null: the script didn't parse.
      val why = if (it == "0") "no evaluate channel in this page" else "the script did not run (a syntax error?)"
      if (it != "1") evaluations.remove(id)?.invoke(failure("ERR_EVALUATE", why))
    }
  }

  private fun failEvaluations() {
    val waiting = evaluations.values.toList()
    evaluations.clear()
    waiting.forEach { it(failure("navigated", "the page navigated before the script finished")) }
  }

  private fun failure(code: String, message: String) = Result.failure<String>(EvaluateError(code, message))

  /** Whether this device's WebView lacks one of [features] that [prop] needs; warns about it once per process. */
  private fun lacks(prop: String, features: List<String>, lost: String): Boolean {
    val missing = features.filterNot(WebViewFeature::isFeatureSupported)
    if (missing.isEmpty()) return false
    if (warnedProps.add(prop)) {
      val provider = WebViewCompat.getCurrentWebViewPackage(owner.context)
      owner.warn(
        "$prop needs WebView features ${missing.joinToString()}, missing in ${provider?.packageName} ${provider?.versionName}: $lost. " +
          "Update Android System WebView."
      )
    }
    return true
  }

  private companion object {
    /** The props [lacks] has warned about. */
    val warnedProps = mutableSetOf<String>()
  }
}

/** Why an `evaluate` failed; [code] is the JS error code (`ERR_EVALUATE`, `navigated`, `unavailable`). */
class EvaluateError(val code: String, message: String) : Exception(message)

private const val EVALUATE = "nativeEvaluateResult"
