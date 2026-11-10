package expo.modules.minimalwebview

import android.content.Context
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.SafeBrowsingResponse
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.SafeBrowsingResponseCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `overrides()`: what counts as a hook client's own override, for plain and WebViewClientCompat subclasses. Which hooks
 * a WebView's `hookOptions` attach, which one's factory makes it, and which registrations under a key that is taken fail.
 */
class HooksTest {
  private class Plain : WebViewClient()
  private class PlainCompat : WebViewClientCompat()
  private class ErrorCompat : WebViewClientCompat() {
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {}
  }
  private class SafeBrowsingCompat : WebViewClientCompat() {
    override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threatType: Int, callback: SafeBrowsingResponseCompat) {}
  }
  private class UrlCompat : WebViewClientCompat() {
    @Deprecated("the platform's") override fun shouldOverrideUrlLoading(view: WebView, url: String) = true
  }
  private class Finished : WebViewClient() {
    override fun onPageFinished(view: WebView, url: String?) {}
  }
  private class PlainDeprecated : WebViewClient() {
    @Deprecated("the platform's") override fun shouldOverrideUrlLoading(view: WebView, url: String) = true
    @Deprecated("the platform's") override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? = null
    @Deprecated("the platform's") override fun onReceivedError(view: WebView, errorCode: Int, description: String, failingUrl: String) {}
  }
  private class ChromeDeprecated : WebChromeClient() {
    @Deprecated("the platform's") override fun onConsoleMessage(message: String, lineNumber: Int, sourceID: String) {}
  }

  private val error = arrayOf(WebView::class.java, WebResourceRequest::class.java, WebResourceError::class.java)
  private val safeBrowsing = arrayOf(WebView::class.java, WebResourceRequest::class.java, Integer.TYPE, SafeBrowsingResponse::class.java)
  private val url = arrayOf(WebView::class.java, WebResourceRequest::class.java)

  private fun hook(key: String, factory: ((Context) -> WebView)? = null) =
    MinimalWebViewHooks.Hook(key, factory, null) { _, _ -> }

  @Test
  fun `a plain subclass overrides only what it declares`() {
    assertTrue(Finished::class.java.overrides("onPageFinished", WebView::class.java, String::class.java))
    assertFalse(Plain::class.java.overrides("onPageFinished", WebView::class.java, String::class.java))
    assertFalse(Plain::class.java.overrides("onReceivedError", *error))
  }

  @Test
  fun `a plain subclass overrides a forwarded callback through its deprecated variant`() {
    assertTrue(PlainDeprecated::class.java.overrides("shouldOverrideUrlLoading", *url))
    assertTrue(PlainDeprecated::class.java.overrides("shouldInterceptRequest", *url))
    assertTrue(PlainDeprecated::class.java.overrides("onReceivedError", *error))
    assertTrue(ChromeDeprecated::class.java.overrides("onConsoleMessage", ConsoleMessage::class.java))
  }

  @Test
  fun `a WebViewClientCompat subclass overrides a forwarded callback through the compat variant`() {
    assertTrue(ErrorCompat::class.java.overrides("onReceivedError", *error))
    assertTrue(SafeBrowsingCompat::class.java.overrides("onSafeBrowsingHit", *safeBrowsing))
    assertTrue(UrlCompat::class.java.overrides("shouldOverrideUrlLoading", *url))
  }

  @Test
  fun `the compat class's own forwarders and empty overrides don't count`() {
    assertFalse(PlainCompat::class.java.overrides("onReceivedError", *error))
    assertFalse(PlainCompat::class.java.overrides("onSafeBrowsingHit", *safeBrowsing))
    // Counting this one would switch the navigation rules off for every WebViewClientCompat hook.
    assertFalse(PlainCompat::class.java.overrides("shouldOverrideUrlLoading", *url))
    assertFalse(PlainCompat::class.java.overrides("onPageCommitVisible", WebView::class.java, String::class.java))
  }

  @Test
  fun `the hooks under the creation keys attach in registration order, and a key without one is reported`() {
    val (attaching, unregistered) = selectHooks(listOf(hook("b"), hook("a"), hook("c")), setOf("a", "b", "typo"))
    assertEquals(listOf("b", "a"), attaching.map { it.key })
    assertEquals(setOf("typo"), unregistered)
  }

  @Test
  fun `the first attaching hook with a factory makes the WebView, and a different one is reported`() {
    val shared: (Context) -> WebView = { WebView(it) }
    val other: (Context) -> WebView = { WebView(it) }
    assertEquals(null to emptyList<String>(), pickFactory(listOf(hook("a"), hook("b"))))
    val (maker, unused) = pickFactory(listOf(hook("a"), hook("b", shared), hook("c", other), hook("d", shared)))
    assertEquals("b", maker?.key)
    assertEquals("the same object on two hooks is one factory", listOf("c"), unused)
  }

  @Test
  fun `a second hook under a key throws, naming it, and the same call again (a JS reload) replaces its hook`() {
    // A module's OnCreate, which a reload runs again.
    fun onCreate() = MinimalWebViewHooks.register("test.taken") { _, _ -> }
    try {
      onCreate()
      onCreate()
      val error = assertThrows(IllegalStateException::class.java) {
        MinimalWebViewHooks.register("test.taken") { _, _ -> }
      }
      assertTrue(error.message, error.message.orEmpty().contains("`test.taken`"))
      MinimalWebViewHooks.register("test.free") { _, _ -> }
      assertEquals(listOf("test.taken", "test.free"), MinimalWebViewHooks.hooks.map { it.key }.filter { it.startsWith("test.") })
    } finally {
      MinimalWebViewHooks.hooks.removeAll { it.key.startsWith("test.") }
    }
  }

  @Test
  fun `changed keys go in registration order, then the unregistered ones sorted`() {
    val keys = linkedSetOf("typo", "c", "a", "b", "other")
    assertEquals(listOf("b", "a", "c", "other", "typo"), inRegistrationOrder(keys, listOf("b", "x", "a", "c")))
  }

  @Test
  fun `a decision goes to the first client that overrides it, and two that do warn once per callback`() {
    val warnings = mutableListOf<String>()
    val deciders = Deciders { warnings += it }
    val overriding = { client: String -> client.startsWith("auth") }
    assertEquals("auth1", deciders.first("onReceivedHttpAuthRequest", listOf("plain", "auth1", "auth2"), overrides = overriding))
    assertEquals("auth1", deciders.first("onReceivedHttpAuthRequest", listOf("auth1", "auth2"), overrides = overriding))
    assertEquals("auth1", deciders.first("onJsAlert", listOf("auth1"), overrides = overriding))
    assertNull(deciders.first("onJsPrompt", listOf("plain"), overrides = overriding))
    assertEquals(listOf("onReceivedHttpAuthRequest: more than one hook client overrides it; only the first one gets it"), warnings)
  }

  @Test
  fun `a client that takes a decision the app's props make warns once, naming what stops applying`() {
    val warnings = mutableListOf<String>()
    val deciders = Deciders { warnings += it }
    val overriding = { client: String -> client == "navigation" }
    val lost = "navigationRules, their defaults and onNavigationRequest don't apply to navigations"
    assertNull(deciders.first("shouldOverrideUrlLoading", listOf("plain"), lost, overriding))
    assertTrue(warnings.isEmpty())
    // The same callback again, as after a crash's recovery attaches the same clients: no second warning.
    repeat(2) { assertEquals("navigation", deciders.first("shouldOverrideUrlLoading", listOf("plain", "navigation"), lost, overriding)) }
    // Without `lost`, taking a decision warns of nothing.
    assertEquals("navigation", deciders.first("onReceivedHttpAuthRequest", listOf("navigation"), overrides = overriding))
    assertEquals(
      listOf(
        "shouldOverrideUrlLoading: a hook client takes it, so navigationRules, their defaults and onNavigationRequest " +
          "don't apply to navigations"
      ),
      warnings
    )
  }

  @Test
  fun `an off or detached attachment drops emits and answers asks null at once`() {
    for (off in listOf(Attachment(null), Attachment("on").also { it.detach() })) {
      var sent = 0
      val answers = mutableListOf<Any?>()
      off.ifRouted { sent++ }
      off.askIfRouted({ answers += it }) { sent++ }
      assertEquals(0, sent)
      assertEquals(listOf<Any?>(null), answers)
    }
    val on = Attachment(true)
    var sent = 0
    val answers = mutableListOf<Any?>()
    on.ifRouted { sent++ }
    on.askIfRouted({ answers += it }) { sent++ }
    assertEquals(2, sent)
    assertTrue(answers.isEmpty())
  }

  @Test
  fun `the core routes the lists of the hooks that are on, in attach order`() {
    val a = Attachment(true)
    val off = Attachment(null)
    val b = Attachment(mapOf<String, Any>())
    val clients = listOf(Plain(), Plain(), Plain(), Plain())
    a.clients += clients[0]
    off.clients += clients[1]
    b.clients += clients[2]
    b.clients += clients[3]
    assertEquals(listOf(clients[0], clients[2], clients[3]), routed(listOf(a, off, b)) { it.clients })

    off.optionsChanged(true)
    assertEquals(clients, routed(listOf(a, off, b)) { it.clients })
    a.optionsChanged(null)
    assertEquals(listOf(clients[1], clients[2], clients[3]), routed(listOf(a, off, b)) { it.clients })
  }

  @Test
  fun `an off hook's clients, chrome clients and listeners are not routed`() {
    val off = Attachment(null)
    off.clients += Plain()
    off.chromeClients += WebChromeClient()
    off.touchListeners += View.OnTouchListener { _, _ -> true }
    off.scrollListeners += View.OnScrollChangeListener { _, _, _, _, _ -> }
    assertEquals(emptyList<WebViewClient>(), routed(listOf(off)) { it.clients })
    assertEquals(emptyList<WebChromeClient>(), routed(listOf(off)) { it.chromeClients })
    assertEquals(emptyList<View.OnTouchListener>(), routed(listOf(off)) { it.touchListeners })
    assertEquals(emptyList<View.OnScrollChangeListener>(), routed(listOf(off)) { it.scrollListeners })
  }

  @Test
  fun `an options handler runs at once with the options, then with each change`() {
    val attachment = Attachment(mapOf("a" to 1.0))
    val seen = mutableListOf<Any?>()
    attachment.onOptions { seen += it }
    assertEquals(listOf<Any?>(mapOf("a" to 1.0)), seen)
    attachment.optionsChanged(mapOf("a" to 2.0))
    assertEquals(listOf<Any?>(mapOf("a" to 1.0), mapOf("a" to 2.0)), seen)
    val off = mutableListOf<Any?>()
    Attachment(null).onOptions { off += it }
    assertEquals(listOf<Any?>(null), off)
  }

  @Test
  fun `an options handler registered on a detached context never runs`() {
    val attachment = Attachment(true)
    attachment.detach()
    val seen = mutableListOf<Any?>()
    attachment.onOptions { seen += it }
    assertTrue(seen.isEmpty())
  }

  @Test
  fun `a key removed after mount reaches the options handlers as null, and a value turns the hook on again`() {
    val attachment = Attachment(mapOf("a" to 1.0))
    val seen = mutableListOf<Any?>()
    attachment.onOptions { seen += it }
    seen.clear()
    attachment.optionsChanged(null)
    assertNull(attachment.options)
    assertFalse(attachment.routed)
    attachment.optionsChanged(true)
    assertTrue(attachment.routed)
    attachment.optionsChanged(null)
    assertEquals(listOf(null, true, null), seen)
    assertFalse(attachment.routed)
  }

  @Test
  fun `a detached context's list edits reach no WebView`() {
    val attachment = Attachment(true)
    val attachments = listOf(attachment)
    attachment.detach()
    attachment.clients += Plain()
    attachment.touchListeners += View.OnTouchListener { _, _ -> true }
    assertEquals(emptyList<WebViewClient>(), routed(attachments) { it.clients })
    assertEquals(emptyList<View.OnTouchListener>(), routed(attachments) { it.touchListeners })
    attachment.optionsChanged(true)
    assertFalse(attachment.routed)
  }

  @Test
  fun `a download is offered only to a hook that is on and attached, and the first handler that takes it ends the round`() {
    val offered = mutableListOf<String>()
    fun Attachment.handler(name: String, takes: Boolean) = onDownloadStart { _, _, _, _, _ -> offered += name; takes }
    val off = Attachment(null).also { it.handler("off", true) }
    val detached = Attachment(true).also { it.handler("detached", true); it.detach() }
    val on = Attachment(true).also { it.handler("skips", false); it.handler("takes", true); it.handler("never", true) }
    val none = Attachment(true)
    assertFalse(off.downloadStarted("u", "ua", "", "", -1))
    assertFalse(detached.downloadStarted("u", "ua", "", "", -1))
    assertFalse(none.downloadStarted("u", "ua", "", "", -1))
    assertTrue(offered.isEmpty())
    assertTrue(on.downloadStarted("u", "ua", "", "", -1))
    assertEquals(listOf("skips", "takes"), offered)
    off.optionsChanged(true)
    assertTrue(off.downloadStarted("u", "ua", "", "", -1))
  }

  @Test
  fun `a hook reply settles its call once, and a reply or a fail after the first does nothing`() {
    val settled = mutableListOf<String>()
    val replied = HookReply({ settled += "resolve $it" }, { settled += "reject $it" })
    replied(1.0)
    replied(2.0)
    replied.fail("late")
    val failed = HookReply({ settled += "resolve $it" }, { settled += "reject $it" })
    failed.fail("no label")
    failed("late")
    failed.fail("again")
    assertEquals(listOf("resolve 1.0", "reject no label"), settled)
  }
}
