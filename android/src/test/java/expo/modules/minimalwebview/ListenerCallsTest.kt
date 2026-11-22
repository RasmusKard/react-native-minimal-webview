package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

class ListenerCallsTest {
  private fun userAgent(chrome: String) =
    "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_arm64 Build/UE1A.230829.050; wv) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Version/4.0 Chrome/$chrome Mobile Safari/537.36"

  @Test
  fun `a vendor WebView numbered apart from its Chromium base is judged by the Chromium version`() {
    val huawei = "Mozilla/5.0 (Linux; Android 12; NOH-NX9; HMSCore 6.13.0.302; wv) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36"
    assertEquals(false, callsListenersDirectly(huawei))
    assertEquals(true, callsListenersDirectly(huawei.replace("Chrome/120", "Chrome/114")))
  }

  @Test
  fun `Chromium before 119 calls listeners directly, 119 and later post them`() {
    assertEquals(true, callsListenersDirectly(userAgent("113.0.5672.136")))
    assertEquals(true, callsListenersDirectly(userAgent("118.0.5993.112")))
    assertEquals(false, callsListenersDirectly(userAgent("119.0.6045.66")))
    assertEquals(false, callsListenersDirectly(userAgent("149.0.0.0")))
  }

  @Test
  fun `a user agent without a Chrome version is taken as a current WebView`() {
    assertEquals(false, callsListenersDirectly(null))
    assertEquals(false, callsListenersDirectly("Mozilla/5.0 (Linux; Android 14; wv)"))
  }
}
