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

  // URLs an `ask` allowed in the current navigation chain: their redirects back to them are not asked again.
  private val askedAndAllowed = mutableSetOf<String>()

  fun newDocument() = askedAndAllowed.clear()

  /** Returns true to cancel the navigation (shouldOverrideUrlLoading's meaning). */
  fun decide(request: NavigationRules.Request): Boolean {
    val decision = NavigationRules.decide(owner.navigationRules, request)
    if (decision.action == "ask" && request.url in askedAndAllowed) {
      notifyNavigation(request, "allow", decision.rule)
      return false
    }
    // An external link that cannot be opened is reported as blocked.
    val action = when (decision.action) {
      "ask" -> return true.also { ask(request, decision.rule) }
      "external" -> if (openExternal(request.url)) "external" else "block"
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
    if (!request.mainFrame) {
      Log.w(TAG, "`ask` only works for main-frame navigations on Android; blocked ${request.url}")
      notifyNavigation(request, "block", rule)
      return
    }
    // Without an onNavigationRequest prop nobody could allow it.
    if ("navigationRequest" !in owner.requestHandlers) {
      notifyNavigation(request, "block", rule)
      return
    }
    val referrer = webView.url
    val id = owner.askWithId("core.navigationRequest", fields(request)) { answer ->
      val action = answer as? String ?: "block"
      if (action == "allow") {
        askedAndAllowed += request.url
        reissue(request.url, referrer)
      }
      val opened = action != "external" || openExternal(request.url)
      notifyNavigation(request, if (action in ACTIONS && opened) action else "block", rule)
    }
    // Unanswered after the timeout: block (the answer callback runs with null). A late answer finds nothing.
    owner.postDelayed({ owner.answer(id, null) }, ASK_TIMEOUT_MS)
  }

  // WebView's request headers on a navigation are empty, so the page's URL goes as the referrer. WebView applies its
  // default policy to it (origin only cross-origin, none from https to http); the page's own referrer policy is lost.
  private fun reissue(url: String, referrer: String?) = webView.loadUrl(url, referrer?.let { mapOf("Referer" to it) }.orEmpty())

  /**
   * A download nothing handled (no `onDownload`): an http(s) one opens externally, reported like an `external`
   * navigation; the browser fetches it without the page's session. A data: or blob: one only the page can read: dropped.
   */
  fun openDownload(url: String) {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      notifyNavigation(NavigationRules.Request(url, true, false, false), if (openExternal(url)) "external" else "block", null)
    } else {
      Log.w(TAG, "dropped a download from ${url.take(40)}")
    }
  }

  /**
   * Opens a URL outside the WebView. Returns false when it could not be opened (the caller reports `block`): a page
   * controls the URL, so a malformed intent (bad syntax, launchFlags=zz) or a refused activity must not crash the app.
   */
  private fun openExternal(url: String): Boolean {
    if ("openExternal" in owner.requestHandlers) return true
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
    return true
  }

  // A throwaway WebView catches the new window's first URL; the rules decide, then it is destroyed.
  fun createWindow(isUserGesture: Boolean, resultMsg: Message): Boolean {
    val child = WebView(owner.context)
    var done = false
    fun finish() {
      if (done) return
      done = true
      owner.post { child.destroy() }
    }
    child.webViewClient = object : WebViewClient() {
      // A renderer crash in the throwaway window must not take the app down.
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail) = true.also { finish() }

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val target = request.url.toString()
        if (!done && !decide(NavigationRules.Request(target, true, true, isUserGesture))) reissue(target, webView.url)
        finish()
        return true
      }
    }
    // window.open('') or about:blank never navigates: give up on it.
    owner.postDelayed(::finish, NEW_WINDOW_TIMEOUT_MS)
    (resultMsg.obj as WebView.WebViewTransport).webView = child
    resultMsg.sendToTarget()
    return true
  }
}

private const val ASK_TIMEOUT_MS = 1000L
private const val NEW_WINDOW_TIMEOUT_MS = 5000L
private val ACTIONS = setOf("allow", "block", "external")
