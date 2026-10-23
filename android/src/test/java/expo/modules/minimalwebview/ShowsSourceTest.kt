package expo.modules.minimalwebview

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** What crash recovery and reload() load again: the source when it is the page on screen, else the page's URL. */
class ShowsSourceTest {
  private val vectors = JSONObject(
    checkNotNull(javaClass.getResource("/vectors/recovery.json")) { "test resource vectors/recovery.json missing" }.readText()
  )

  @Test
  fun sharedVectors() {
    val cases = vectors.getJSONArray("source")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val source = WebViewSource(uri = case.getString("uri"))
      assertEquals(case.getString("name"), case.getBoolean("shows"), showsSource(source, case.getString("url")))
    }
  }

  @Test
  fun cases() {
    val page = WebViewSource(uri = "https://example.com/page", headers = mapOf("Authorization" to "x"))
    val html = WebViewSource(html = "<p>", baseUrl = "https://example.com")
    val cases = listOf(
      Triple(null, "", false),
      Triple(null, "https://example.com/", false),
      Triple(page, "", true), // nothing committed yet
      Triple(html, "https://example.com/", true), // Chromium canonicalizes the baseUrl
      Triple(html, "https://example.com/other", false),
      Triple(WebViewSource(html = "<p>"), "about:blank", true),
      Triple(WebViewSource(html = "<p>"), "https://example.com/", false)
    )
    for ((source, url, expected) in cases) assertEquals("$source at $url", expected, showsSource(source, url))
  }
}
