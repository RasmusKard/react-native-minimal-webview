package expo.modules.minimalwebview

import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.exception.CodedException
import org.json.JSONArray

/** Scripts in the page: the bridge transport, `injectedScripts` and `evaluate`. */
internal class MinimalWebViewScripts(private val owner: MinimalWebView, private val onBridge: (Map<String, Any?>) -> Unit) {
  private val webView get() = owner.webView

  // Bridge: the page posts through `window.nativeBridgeTransport`; replies go to the main frame's latest proxy.
  private var replyProxy: JavaScriptReplyProxy? = null
  private var installedScripts: List<InjectedScript>? = null
  private val scriptHandlers = mutableListOf<ScriptHandler>()
  private val evaluations = Evaluations()

  /**
   * Installs everything into a new WebView, the first or the one after a crash. The evaluate channel and the bridge go
   * in only here: JS fixes `bridge` at mount.
   */
  fun install() {
    installEvaluate()
    installBridge()
    installScripts(force = true)
  }

  /** A later prop batch: only `injectedScripts` can change. */
  fun update() = installScripts()

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
    try {
      WebViewCompat.addWebMessageListener(webView, "nativeBridgeTransport", origins) { _, message, sourceOrigin, isMainFrame, proxy ->
        // Main frame only, like iOS. The origin rules already filtered the sender; its origin goes to the handlers.
        if (!isMainFrame) return@addWebMessageListener
        // An ArrayBuffer has no string data (`data` throws); iOS drops a non-string message too.
        if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
        replyProxy = proxy
        onBridge(mapOf("message" to message.data, "origin" to sourceOrigin.toString()))
      }
      // Runs before the page's own scripts, after the transport object exists.
      WebViewCompat.addDocumentStartJavaScript(webView, script, origins)
    } catch (e: IllegalArgumentException) {
      failed("bridge not installed: invalid allowedOrigins $origins", e)
      onBridge(mapOf("unavailable" to true))
    }
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
      val source = if (script.allFrames != true) "if (window !== window.top) throw 0;\n$code" else code
      scriptHandlers += WebViewCompat.addDocumentStartJavaScript(webView, source, setOf("*"))
    }
  }

  fun post(message: String) {
    replyProxy?.postMessage(message)
  }

  /** The Document ended: its evaluations fail and its reply proxy is gone. JS queues bridge messages until the next
   * page is ready; at unmount it rejects what is in flight itself. */
  fun documentEnded(reason: DocumentEnd) {
    evaluations.failAll()
    // At a commit this runs one main-thread hop after Chromium's (the NavigationListener's executor posts it), and
    // relies on landing before the new page's first message sets replyProxy (the bridge suite's head-script call).
    replyProxy = null
    if (reason != DocumentEnd.CLOSING && owner.bridgeScript != null) onBridge(mapOf("navigated" to true))
  }

  /** `evaluate` results come back through one global in every frame (`*`, before the first document); only the main
   * frame's replies count. A page can forge them, as it can already shape any value its own world returns. */
  private fun installEvaluate() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    WebViewCompat.addWebMessageListener(webView, EVALUATE, setOf("*")) { _, message, _, isMainFrame, _ ->
      // An ArrayBuffer has no string data (`data` throws).
      if (message.type == WebMessageCompat.TYPE_STRING) evaluations.settle(message.data, isMainFrame)
    }
  }

  /** The `evaluate` ref method. A new document rejects what is still waiting: WebView drops the callback when the
   * document is replaced first. */
  fun evaluate(script: String, onResult: (Result<String>) -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      return onResult(failure("unavailable", "evaluate needs WEB_MESSAGE_LISTENER; update Android System WebView"))
    }
    val id = evaluations.add(onResult)
    // The script sits in a scope of its own (no wrapper names shadow the page's); the sync value is 1 once it started.
    val code = """typeof $EVALUATE === 'object' ? ((t, p) => (p.then(
  (v) => { try { v = JSON.stringify(v) } catch { v = null } t.postMessage(JSON.stringify([$id, v ?? 'null'])) },
  (e) => { try { e = String(e) } catch { e = 'Error' } t.postMessage(JSON.stringify([$id, null, e])) }
), 1))($EVALUATE, (async () => (
$script
))()) : 0"""
    webView.evaluateJavascript(code) { value ->
      if (value == "1") return@evaluateJavascript
      // 0: the page has no channel (it loaded before the listener); null: the script didn't parse.
      evaluations.fail(id, if (value == "0") "no evaluate channel in this page" else "the script did not run (a syntax error?)")
    }
  }

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
    val warnedProps = mutableSetOf<String>()
  }
}

/**
 * The `evaluate` calls waiting for their result, by id. Each settles once: by the page's reply, a script that didn't
 * run, or the Document's end. Main thread only.
 */
internal class Evaluations {
  private val waiting = mutableMapOf<Int, (Result<String>) -> Unit>()
  private var next = 0

  /** Keeps [onResult] until its evaluation settles; returns the id the page's reply carries. */
  fun add(onResult: (Result<String>) -> Unit): Int {
    val id = next++
    waiting[id] = onResult
    return id
  }

  /**
   * The page's [reply], `[id, valueJson]` or `[id, null, errorMessage]`, settles evaluation `id` with the value or a
   * `script_error`. Only the main frame's replies count; a malformed one, or one for an id not waiting, is dropped.
   */
  fun settle(reply: String?, mainFrame: Boolean) {
    if (!mainFrame) return
    val parts = runCatching { JSONArray(reply) }.getOrNull() ?: return
    val onResult = waiting.remove(parts.optInt(0, -1)) ?: return
    onResult(
      if (parts.length() > 2) failure("script_error", parts.optString(2))
      else Result.success(parts.optString(1, "null"))
    )
  }

  /** The script didn't run: evaluation [id] fails with a `script_error` saying [why], unless it settled already. */
  fun fail(id: Int, why: String) {
    waiting.remove(id)?.invoke(failure("script_error", why))
  }

  /** The Document ended: every waiting evaluation fails with `navigated`. */
  fun failAll() {
    val all = waiting.values.toList()
    waiting.clear()
    all.forEach { it(failure("navigated", "the page navigated before the script finished")) }
  }
}

/** Why an `evaluate` failed; its code is the JS error code (`script_error`, `navigated`, `unavailable`). */
internal class EvaluateError(code: String, message: String) : CodedException(code, message, null)

private fun failure(code: String, message: String) = Result.failure<String>(EvaluateError(code, message))

private const val EVALUATE = "nativeEvaluateResult"
