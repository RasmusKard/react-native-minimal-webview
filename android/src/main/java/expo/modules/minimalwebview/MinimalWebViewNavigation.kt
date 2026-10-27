package expo.modules.minimalwebview

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Message
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.URISyntaxException

/** Navigation decisions: the rules, `ask`, external links and new windows. */
internal class MinimalWebViewNavigation(
  private val owner: MinimalWebView,
  private val onNavigation: (Map<String, Any?>) -> Unit
) {
  private val webView get() = owner.webView

  // URLs an `ask` allowed in this Document: a redirect back to one is not asked again (a later tap on it is).
  private val askedAndAllowed = mutableSetOf<String>()

  // New windows still waiting for their first URL (createWindow).
  private val children = mutableSetOf<WebView>()

  fun documentEnded() {
    askedAndAllowed.clear()
    // Not on a child's stack (a commit, a crash, destroy): destroy them now. Cleared first, so a finish() finds none.
    val ended = children.toList()
    children.clear()
    ended.forEach { it.destroy() }
  }

  /** Returns true to cancel the navigation (shouldOverrideUrlLoading's meaning). */
  fun decide(request: NavigationRules.Request): Boolean {
    val asked = if (request.isRedirect) askedAndAllowed else emptySet()
    val decision = NavigationRules.decide(owner.navigationRules, request, asked, "navigationRequest" in owner.requestHandlers)
    val action = when (decision.action) {
      "ask" -> if (request.mainFrame) {
        return true.also { ask(request, decision.rule) }
      } else {
        // Android can't hold a navigation, so `ask` cancels and reissues it: a subframe's can't be reissued.
        Log.w(TAG, "`ask` only works for main-frame navigations on Android; blocked ${request.url}")
        "block"
      }
      "external" -> return true.also { openExternal(request, decision.rule) }
      else -> decision.action
    }
    notifyNavigation(request, action, decision.rule)
    return action != "allow"
  }

  private fun fields(request: NavigationRules.Request) = mapOf(
    "url" to request.url,
    "mainFrame" to request.mainFrame,
    "newWindow" to request.newWindow,
    "userInitiated" to request.userInitiated
  )

  private fun notifyNavigation(request: NavigationRules.Request, action: String, rule: Int?) =
    onNavigation(fields(request) + mapOf("action" to action, "rule" to rule))

  // Cancel now, ask JS, reissue on allow. Never blocks the UI thread. Loses the gesture flag and the redirect chain.
  private fun ask(request: NavigationRules.Request, rule: Int?) {
    val referrer = webView.url
    val id = owner.asks.ask("core.navigationRequest", fields(request)) { answer ->
      val action = NavigationRules.answer(answer)
      if (action == "allow") {
        askedAndAllowed += request.url
        reissue(request.url, referrer)
      }
      if (action == "external") openExternal(request, rule) else notifyNavigation(request, action, rule)
    }
    // Unanswered after the timeout: block (the answer callback runs with null). A late answer finds nothing.
    owner.mainHandler.postDelayed({ owner.asks.cancel(id) }, ASK_TIMEOUT_MS)
  }

  // WebView's request headers on a navigation are empty, so the page's URL goes as the referrer. WebView applies its
  // default policy to it (origin only cross-origin, none from https to http); the page's own referrer policy is lost.
  // loadUrl skips shouldOverrideUrlLoading, so the reissued URL isn't asked again (its redirects still go to decide).
  private fun reissue(url: String, referrer: String?) = webView.loadUrl(url, referrer?.let { mapOf("Referer" to it) }.orEmpty())

  /**
   * A download nothing handled (no `onDownload`): an http(s) one opens externally, reported like an `external`
   * navigation; the browser fetches it without the page's session. A data: or blob: one only the page can read: dropped.
   */
  fun openDownload(url: String) {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      openExternal(NavigationRules.Request(url, true, false, false), null)
    } else {
      Log.w(TAG, "dropped a download from ${url.take(40)}")
    }
  }

  /**
   * Opens an `external` navigation and reports it (`block` when nothing opened it): the app's `onOpenExternal` if set,
   * and [open] when it isn't or answers false.
   */
  private fun openExternal(request: NavigationRules.Request, rule: Int?) {
    val report = { opened: Boolean -> notifyNavigation(request, if (opened) "external" else "block", rule) }
    if ("openExternal" !in owner.requestHandlers) return report(open(request.url))
    // Only false hands the URL back: null (a throw, or the page moved on first) means the app has it. No timeout, as
    // nothing waits for the answer: the navigation is cancelled already.
    owner.asks.ask("core.openExternal", mapOf("url" to request.url)) { answer ->
      report(answer != false || open(request.url))
    }
  }

  /**
   * Opens a URL outside the WebView. Returns false when it could not be opened (the caller reports `block`): a page
   * controls the URL, so a malformed intent (bad syntax, launchFlags=zz) or a refused activity must not crash the app.
   */
  private fun open(url: String): Boolean {
    val intent = try {
      browsableIntent(url)
    } catch (e: URISyntaxException) {
      return failed("malformed external URL $url", e)
    } catch (e: IllegalArgumentException) {
      return failed("malformed external URL $url", e)
    }
    return try {
      owner.context.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      openFallback(intent, url, e)
    } catch (e: SecurityException) {
      failed("not allowed to open $url", e)
    }
  }

  /** Only what a browser would allow: BROWSABLE, no explicit component or selector, and no URI permission grants. */
  private fun browsableIntent(url: String): Intent {
    val intent = if (url.startsWith("intent:", ignoreCase = true)) {
      Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
        component = null
        selector = null
      }
    } else {
      Intent(Intent.ACTION_VIEW, Uri.parse(url))
    }
    intent.addCategory(Intent.CATEGORY_BROWSABLE)
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    return intent
  }

  // No app for the link: an intent may name a web fallback, as Chrome supports. It goes through the rules like any
  // other navigation. Otherwise nothing happens.
  private fun openFallback(intent: Intent, url: String, error: ActivityNotFoundException): Boolean {
    val fallback = intent.getStringExtra("browser_fallback_url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
      ?: return failed("no app opens $url", error)
    if (!decide(NavigationRules.Request(fallback, true, false, false))) webView.loadUrl(fallback)
    // Nothing opened externally: the intent is reported as blocked, the fallback by its own decision.
    return false
  }

  // A throwaway WebView catches the new window's first URL; the rules decide, then it is destroyed. Never a second
  // WebView for the app: a popup model is more than almost any app wants, and a hook chrome client's `onCreateWindow`
  // owns one when it must.
  fun createWindow(isUserGesture: Boolean, resultMsg: Message): Boolean {
    val child = WebView(owner.context)
    // It only catches a URL: none of the page's access, and no JS of its own.
    child.settings.allowFileAccess = false
    child.settings.allowContentAccess = false
    child.settings.javaScriptEnabled = false
    children += child
    // Finishes once, whichever comes first: the first URL, the timeout, a crash, the Document's end (documentEnded).
    // Destroyed later: this may run inside the child's own callback.
    fun finish() = children.remove(child).also { if (it) owner.mainHandler.post { child.destroy() } }
    child.webViewClient = object : WebViewClient() {
      // A renderer crash in the throwaway window must not take the app down.
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail) = true.also { finish() }

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val target = request.url.toString()
        if (finish() && !decide(NavigationRules.Request(target, true, true, isUserGesture))) reissue(target, webView.url)
        return true
      }
    }
    // window.open('') or about:blank never navigates: give up on it.
    owner.mainHandler.postDelayed({ finish() }, NEW_WINDOW_TIMEOUT_MS)
    (resultMsg.obj as WebView.WebViewTransport).webView = child
    resultMsg.sendToTarget()
    return true
  }
}

private const val ASK_TIMEOUT_MS = 1000L
private const val NEW_WINDOW_TIMEOUT_MS = 5000L
