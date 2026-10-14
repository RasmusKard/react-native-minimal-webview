package expo.modules.minimalwebview

import android.webkit.SafeBrowsingResponse
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.SafeBrowsingResponseCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** `overrides()`: what counts as a hook client's own override, for plain and WebViewClientCompat subclasses. */
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

  private val error = arrayOf(WebView::class.java, WebResourceRequest::class.java, WebResourceError::class.java)
  private val safeBrowsing = arrayOf(WebView::class.java, WebResourceRequest::class.java, Integer.TYPE, SafeBrowsingResponse::class.java)
  private val url = arrayOf(WebView::class.java, WebResourceRequest::class.java)

  @Test
  fun `a plain subclass overrides only what it declares`() {
    assertTrue(Finished::class.java.overrides("onPageFinished", WebView::class.java, String::class.java))
    assertFalse(Plain::class.java.overrides("onPageFinished", WebView::class.java, String::class.java))
    assertFalse(Plain::class.java.overrides("onReceivedError", *error))
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
}
