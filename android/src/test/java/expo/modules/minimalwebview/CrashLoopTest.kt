package expo.modules.minimalwebview

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class CrashLoopTest {
  private val vectors = JSONObject(
    checkNotNull(javaClass.getResource("/vectors/recovery.json")) { "test resource vectors/recovery.json missing" }.readText()
  )

  @Test
  fun sharedVectors() {
    val cases = vectors.getJSONArray("crashGuard")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val times = ArrayDeque<Long>()
      val crashes = case.getJSONArray("crashes")
      for (j in 0 until crashes.length()) {
        val crash = crashes.getJSONObject(j)
        val at = crash.getLong("at")
        assertEquals("${case.getString("name")} at $at", crash.getBoolean("reload"), crashAllowsReload(times, at))
      }
    }
  }

  @Test
  fun sameDeath() {
    val times = ArrayDeque<Long>()
    val cases = listOf(
      0L to true,
      50L to true,
      5_000L to true,
      10_000L to true,
      15_000L to false,
      15_050L to false
    )
    for ((now, expected) in cases) assertEquals("at $now", expected, crashAllowsReload(times, now))
  }
}
