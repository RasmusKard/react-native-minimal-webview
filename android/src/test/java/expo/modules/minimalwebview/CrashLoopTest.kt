package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

/** The crash-loop guard: at most 3 renderer deaths in 60 s reload, and the other WebViews' reports of one count once. */
class CrashLoopTest {
  @Test
  fun cases() {
    val times = ArrayDeque<Long>()
    val cases = listOf(
      0L to true,
      50L to true, // another WebView's report of the same death
      5_000L to true,
      10_000L to true,
      15_000L to false, // the 4th in 60 s
      15_050L to false, // the same 4th death, reported again
      80_000L to true // the earlier deaths are out of the window
    )
    for ((now, expected) in cases) assertEquals("at $now", expected, crashAllowsReload(times, now))
  }
}
