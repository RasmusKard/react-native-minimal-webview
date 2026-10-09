package expo.modules.minimalwebview

import expo.modules.minimalwebview.extensions.OriginRules
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class OriginRulesTest {
  @Test
  fun sharedVectors() {
    val cases = JSONObject(File("../test-vectors/origin-rules.json").readText()).getJSONArray("cases")
    val failures = (0 until cases.length()).map { cases.getJSONObject(it) }.filter { case ->
      val rules = case.getJSONArray("rules").let { rules -> (0 until rules.length()).map { rules.getString(it) } }
      OriginRules.allows(rules, case.getString("origin")) != case.getBoolean("allowed")
    }
    assertEquals(emptyList<String>(), failures.map { it.getString("name") })
  }
}
