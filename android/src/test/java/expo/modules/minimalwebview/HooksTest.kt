package expo.modules.minimalwebview

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
 * a WebView's `hookOptions` attach, and which registrations under a key that is taken fail.
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

  private fun hook(key: String) = MinimalWebViewHooks.Hook(key, null) { _, _ -> null }

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
  fun `a hookOptions value enables its hook unless it is null or false`() {
    for (value in listOf(null, false)) assertFalse("$value", enables(value))
    for (value in listOf(true, 0.0, "", mapOf<String, Any>(), listOf<Any>())) assertTrue("$value", enables(value))
  }

  @Test
  fun `the hooks under the creation keys attach in registration order, and a key without one is reported`() {
    val (attaching, unregistered) = selectHooks(listOf(hook("b"), hook("a"), hook("c")), setOf("a", "b", "typo"))
    assertEquals(listOf("b", "a"), attaching.map { it.key })
    assertEquals(setOf("typo"), unregistered)
  }

  @Test
  fun `a second hook under a key throws, naming it, and the same call again (a JS reload) replaces its hook`() {
    // A module's OnCreate, which a reload runs again.
    fun onCreate() = MinimalWebViewHooks.register("test.taken") { _, _ -> null }
    try {
      onCreate()
      onCreate()
      val error = assertThrows(IllegalStateException::class.java) {
        MinimalWebViewHooks.register("test.taken") { _, _ -> null }
      }
      assertTrue(error.message, error.message.orEmpty().contains("`test.taken`"))
      MinimalWebViewHooks.register("test.free") { _, _ -> null }
      assertEquals(listOf("test.taken", "test.free"), MinimalWebViewHooks.hooks.map { it.key }.filter { it.startsWith("test.") })
    } finally {
      MinimalWebViewHooks.hooks.removeAll { it.key.startsWith("test.") }
    }
  }

  @Test
  fun `a key turned on while not attached is added late, and an attached one never is`() {
    val attached = setOf("a")
    assertTrue(addedLate("b", null, mapOf("enabled" to false), attached))
    assertTrue(addedLate("b", false, 0.0, attached))
    assertFalse("on already, so attached or warned already", addedLate("b", true, mapOf("enabled" to false), attached))
    assertFalse("turned off", addedLate("b", true, false, attached))
    assertFalse("attached, so its hook gets the change", addedLate("a", false, true, attached))
  }

  @Test
  fun `a late key attaches a hook without configure, and warns for one with configure or none`() {
    assertNull(lateAttachWarning("a", hook("a")))
    val configured = MinimalWebViewHooks.Hook("b", { _, _ -> }) { _, _ -> null }
    assertTrue(lateAttachWarning("b", configured).orEmpty().contains("attaches only when the WebView is created"))
    assertTrue(lateAttachWarning("typo", null).orEmpty().contains("no hook is registered"))
  }
}
