package expo.modules.minimalwebview

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.FileUriExposedException
import android.os.Message
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.URISyntaxException

internal class MinimalWebViewNavigation(private val owner: MinimalWebView) {
  private val webView get() = owner.webView

  private val askedAndAllowed = mutableSetOf<String>()

  private val pendingWindows = mutableSetOf<WebView>()

  fun documentEnded() {
    askedAndAllowed.clear()
    val ended = pendingWindows.toList()
    pendingWindows.clear()
    ended.forEach { it.destroy() }
  }

  fun cancels(request: NavigationRules.Request): Boolean {
    val asked = if (request.isRedirect) askedAndAllowed else emptySet()
    val decision = NavigationRules.decide(owner.navigationRules, request, asked, "onNavigationRequest" in owner.requestHandlers)
    when (decision.action) {
      NavigationRules.Action.ASK -> if (request.mainFrame) {
        ask(request, decision.rule)
      } else {
        // loadUrl reissues only a main-frame navigation.
        Log.w(TAG, "`ask` only works for main-frame navigations on Android; blocked ${request.url}")
        notifyNavigation(request, NavigationRules.Action.BLOCK, decision.rule)
      }
      NavigationRules.Action.EXTERNAL -> openExternal(request, decision.rule)
      else -> notifyNavigation(request, decision.action, decision.rule)
    }
    return decision.action != NavigationRules.Action.ALLOW
  }

  private fun fields(request: NavigationRules.Request) = mapOf(
    "url" to request.url,
    "mainFrame" to request.mainFrame,
    "newWindow" to request.newWindow,
    "userInitiated" to request.userInitiated
  )

  private fun notifyNavigation(request: NavigationRules.Request, action: NavigationRules.Action, rule: Int?) {
    if ("onNavigation" in owner.requestHandlers) owner.emit("core", "onNavigation", fields(request) + mapOf("action" to action.jsName, "rule" to rule))
  }

  private fun ask(request: NavigationRules.Request, rule: Int?) {
    val referrer = webView.url
    val id = owner.asks.ask("core", "onNavigationRequest", fields(request)) { answer ->
      val action = NavigationRules.answer(answer)
      if (action == NavigationRules.Action.ALLOW) {
        askedAndAllowed += request.url
        reissue(request.url, referrer)
      }
      if (action == NavigationRules.Action.EXTERNAL) openExternal(request, rule) else notifyNavigation(request, action, rule)
    }
    if (id != null) mainHandler.postDelayed({ owner.asks.cancel(id) }, ASK_TIMEOUT_MS)
  }

  // WebView's request headers on a navigation are empty. WebView trims the Referer by its default policy (origin only
  // cross-origin, none from https to http). loadUrl skips shouldOverrideUrlLoading, but its redirects reach it.
  private fun reissue(url: String, referrer: String?) = webView.loadUrl(url, referrer?.let { mapOf("Referer" to it) }.orEmpty())

  fun openDownload(url: String) {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      openExternal(NavigationRules.Request(url, true, false, false), null)
    } else {
      Log.w(TAG, "dropped a download from ${url.take(40)}")
    }
  }

  private fun openExternal(request: NavigationRules.Request, rule: Int?) {
    val report = { opened: Boolean ->
      notifyNavigation(request, if (opened) NavigationRules.Action.EXTERNAL else NavigationRules.Action.BLOCK, rule)
    }
    if ("onOpenExternal" !in owner.requestHandlers) return report(open(request.url))
    owner.asks.ask("core", "onOpenExternal", fields(request)) { answer ->
      val appDeclined = answer == false
      report(if (appDeclined) open(request.url) else true)
    }
  }

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
    } catch (e: FileUriExposedException) { // Android refuses to hand a `file:` URL to another app
      failed("not allowed to open $url", e)
    }
  }

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

  // No app for the link: an intent may name a web fallback, as Chrome supports.
  private fun openFallback(intent: Intent, url: String, error: ActivityNotFoundException): Boolean {
    val fallback = intent.getStringExtra("browser_fallback_url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
      ?: return failed("no app opens $url", error)
    if (!cancels(NavigationRules.Request(fallback, true, false, false))) webView.loadUrl(fallback)
    return false
  }

  fun createWindow(isUserGesture: Boolean, resultMsg: Message): Boolean {
    val child = WebView(owner.context)
    child.settings.allowFileAccess = false
    child.settings.allowContentAccess = false
    child.settings.javaScriptEnabled = false
    pendingWindows += child
    // Destroyed later: this may run inside the child's own callback.
    fun finish(): Boolean {
      val wasPending = pendingWindows.remove(child)
      if (wasPending) mainHandler.post { child.destroy() }
      return wasPending
    }
    child.webViewClient = object : WebViewClient() {
      // Returning true keeps the app alive.
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        finish()
        return true
      }

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val target = request.url.toString()
        if (finish() && !cancels(NavigationRules.Request(target, true, true, isUserGesture))) reissue(target, webView.url)
        return true
      }
    }
    // window.open('') or about:blank never navigates.
    mainHandler.postDelayed({ finish() }, NEW_WINDOW_TIMEOUT_MS)
    (resultMsg.obj as WebView.WebViewTransport).webView = child
    resultMsg.sendToTarget()
    return true
  }
}

private const val ASK_TIMEOUT_MS = 1000L
private const val NEW_WINDOW_TIMEOUT_MS = 5000L
