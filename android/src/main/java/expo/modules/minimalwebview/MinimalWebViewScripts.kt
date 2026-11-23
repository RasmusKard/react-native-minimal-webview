package expo.modules.minimalwebview

import android.webkit.WebSettings
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.exception.CodedException
import org.json.JSONArray

internal class MinimalWebViewScripts(private val owner: MinimalWebView, private val onBridge: (Map<String, Any?>) -> Unit) {
  private val webView get() = owner.webView

  private var replyProxy: JavaScriptReplyProxy? = null
  private var installedScripts: List<InjectedScript>? = null
  private val scriptHandlers = mutableListOf<ScriptHandler>()
  private val evaluations = Evaluations()
  private val webViewCallsListenersDirectly by lazy { callsListenersDirectly(WebSettings.getDefaultUserAgent(owner.context)) }

  fun install() {
    // After a crash they are the destroyed WebView's: removing them would call into it.
    scriptHandlers.clear()
    installEvaluate()
    installFrameHistory()
    installBridge()
    update(force = true)
  }

  // WebView reports no iframe navigation, though its history entries change canGoBack and canGoForward.
  private fun installFrameHistory() {
    val features = listOf(WebViewFeature.WEB_MESSAGE_LISTENER, WebViewFeature.DOCUMENT_START_SCRIPT)
    if (!features.all(WebViewFeature::isFeatureSupported)) return
    WebViewCompat.addWebMessageListener(webView, FRAME_NAVIGATED, setOf("*")) { _, _, _, _, _ -> owner.stateChanged() }
    WebViewCompat.addDocumentStartJavaScript(webView, FRAME_NAVIGATED_SCRIPT, setOf("*"))
  }

  private fun installBridge() {
    val script = owner.bridgeScript ?: return
    val bridgeFeatures = listOf(WebViewFeature.WEB_MESSAGE_LISTENER, WebViewFeature.DOCUMENT_START_SCRIPT)
    if (lacks("bridge", bridgeFeatures, "bridge calls reject with `unavailable`")) {
      onBridge(mapOf("unavailable" to true))
      return
    }
    val origins = owner.bridgeOrigins.orEmpty().toSet()
    try {
      WebViewCompat.addWebMessageListener(webView, "nativeBridgeTransport", origins) { _, message, sourceOrigin, isMainFrame, proxy ->
        if (!isMainFrame) return@addWebMessageListener
        // An ArrayBuffer message has no string data: WebMessageCompat.getData throws for it.
        if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
        val data = message.data
        val deliver = Runnable {
          replyProxy = proxy
          onBridge(mapOf("message" to data, "origin" to sourceOrigin.toString()))
        }
        // Chromium before 119 calls this as the message arrives, ahead of the onPageStarted it posted at the commit.
        if (webViewCallsListenersDirectly) mainHandler.postDelayed(deliver, this, 0) else deliver.run()
      }
      WebViewCompat.addDocumentStartJavaScript(webView, script, origins)
    } catch (e: IllegalArgumentException) {
      failed("bridge not installed: invalid allowedOrigins $origins", e)
      onBridge(mapOf("unavailable" to true))
    }
  }

  /** Installs `injectedScripts` if they changed, or with [force] always. They take effect from the next navigation. */
  fun update(force: Boolean = false) {
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

  fun documentEnded(reason: DocumentEnd) {
    evaluations.failAll()
    if (reason != DocumentEnd.COMMITTED) mainHandler.removeCallbacksAndMessages(this)
    replyProxy = null
    if (reason == DocumentEnd.COMMITTED && owner.bridgeScript != null) onBridge(mapOf("navigated" to true))
    if (reason == DocumentEnd.CRASHED && owner.bridgeScript != null) onBridge(mapOf("crashed" to true))
  }

  private fun installEvaluate() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    WebViewCompat.addWebMessageListener(webView, EVALUATE, setOf("*")) { _, message, _, isMainFrame, _ ->
      if (message.type == WebMessageCompat.TYPE_STRING) evaluations.settle(message.data, isMainFrame)
    }
  }

  /** A new Document rejects what is still waiting: WebView drops the callback when the document is replaced first. */
  fun evaluate(script: String, onResult: (Result<String>) -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      return onResult(failure("unavailable", "evaluate needs WEB_MESSAGE_LISTENER; update Android System WebView"))
    }
    val id = evaluations.add(onResult)
    val code = """typeof $EVALUATE === 'object' ? ((t, p) => (p.then(
  (v) => { try { v = JSON.stringify(v) } catch { v = null } t.postMessage(JSON.stringify([$id, v ?? 'null'])) },
  (e) => { try { e = String(e) } catch { e = 'Error' } t.postMessage(JSON.stringify([$id, null, e])) }
), $STARTED))($EVALUATE, (async () => (
$script
))()) : $NO_CHANNEL"""
    webView.evaluateJavascript(code) { value ->
      if (value == STARTED) return@evaluateJavascript
      evaluations.fail(id, if (value == NO_CHANNEL) "no evaluate channel in this page" else "the script did not run (a syntax error?)")
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
 * Each evaluation settles once: by the page's reply, a script that didn't run, or the Document's end. Main thread only.
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

/**
 * Whether the WebView whose default user agent is [defaultUserAgent] calls web message listeners as the message
 * arrives: Chromium before 119 does. Its `Chrome/` token names the Chromium base; a vendor's WebView package (Huawei's
 * is 11.x to 15.x) numbers itself apart from it.
 */
internal fun callsListenersDirectly(defaultUserAgent: String?): Boolean {
  val major = defaultUserAgent?.let { CHROME_MAJOR.find(it) }?.groupValues?.get(1)?.toIntOrNull()
  return major != null && major < FIRST_CHROMIUM_POSTING_LISTENER_CALLS
}

private val CHROME_MAJOR = Regex("""Chrome/(\d+)""")
private const val FIRST_CHROMIUM_POSTING_LISTENER_CALLS = 119
private const val EVALUATE = "nativeEvaluateResult"
private const val FRAME_NAVIGATED = "nativeFrameNavigated"

// A new document, then each same-document navigation (Navigation API, WebView 102 and later).
private const val FRAME_NAVIGATED_SCRIPT = """if (window !== window.top) {
  const navigated = () => $FRAME_NAVIGATED.postMessage('');
  navigated();
  window.navigation?.addEventListener('currententrychange', navigated);
}"""
private const val STARTED = "1"
private const val NO_CHANNEL = "0"
