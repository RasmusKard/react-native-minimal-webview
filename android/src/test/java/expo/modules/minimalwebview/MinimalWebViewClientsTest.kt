package expo.modules.minimalwebview

import android.webkit.WebChromeClient
import android.webkit.WebViewClient
import java.lang.reflect.Modifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The core's clients forward every platform callback to the hook clients (docs/native-hooks.md), and Android can't do
 * that dynamically: each callback is an override in MinimalWebViewClients.kt. One a newer SDK adds, or one that was
 * missed, fails here by name.
 */
class MinimalWebViewClientsTest {
  @Test
  fun `Client overrides every WebViewClient callback`() = assertCovers(WebViewClient::class.java, Client::class.java)

  @Test
  fun `ChromeClient overrides every WebChromeClient callback`() =
    assertCovers(WebChromeClient::class.java, ChromeClient::class.java)

  private fun assertCovers(platform: Class<*>, core: Class<*>) {
    val callbacks = platform.declaredMethods
      .filter { Modifier.isPublic(it.modifiers) && !Modifier.isStatic(it.modifiers) && !it.isSynthetic }
      .filterNot { it.isAnnotationPresent(java.lang.Deprecated::class.java) }
    assertTrue("the SDK stubs expose the callbacks", callbacks.size > 10)
    val missing = callbacks
      .filterNot { runCatching { core.getDeclaredMethod(it.name, *it.parameterTypes) }.isSuccess }
      .map { "${it.name}(${it.parameterTypes.joinToString { p -> p.simpleName }})" }
      .sorted()
    assertEquals(emptyList<String>(), missing)
  }
}
