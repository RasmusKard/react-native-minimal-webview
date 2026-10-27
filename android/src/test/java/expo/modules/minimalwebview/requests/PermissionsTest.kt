package expo.modules.minimalwebview.requests

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The origin a permission request is matched and reported by. `Uri` is a stub in JVM tests, so a URL comes as the
 * parts it parses: `data:` and `about:` URLs have no host, `file:///x` an empty one, and `""` no scheme either.
 */
class PermissionsTest {
  @Test
  fun `the scheme's default port is left out`() {
    assertEquals("https://example.com:8443", Permissions.origin("https", "example.com", 8443))
    assertEquals("https://example.com", Permissions.origin("https", "example.com", 443))
    assertEquals("https://example.com", Permissions.origin("https", "example.com", -1))
    assertEquals("http://example.com", Permissions.origin("http", "example.com", 80))
    assertEquals("http://example.com:443", Permissions.origin("http", "example.com", 443))
  }

  @Test
  fun `a URL without a host keeps its null parts`() {
    assertEquals("data://null", Permissions.origin("data", null, -1)) // data:text/html,hi
    assertEquals("about://null", Permissions.origin("about", null, -1)) // about:blank
    assertEquals("file://", Permissions.origin("file", "", -1)) // file:///x
    assertEquals("null://null", Permissions.origin(null, null, -1)) // ""
    assertNull(Permissions.originOf(null))
  }
}
