package expo.modules.minimalwebview

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationRulesTest {
  private val vectors = JSONObject(
    checkNotNull(javaClass.getResource("/vectors/navigation-rules.json")) { "test resource vectors/navigation-rules.json missing" }.readText()
  )

  private fun toKotlin(value: Any?): Any? = when (value) {
    is JSONObject -> value.keys().asSequence().associateWith { toKotlin(value.get(it)) }
    is JSONArray -> (0 until value.length()).map { toKotlin(value.get(it)) }
    JSONObject.NULL -> null
    else -> value
  }

  @Test
  fun sharedVectors() {
    val rulesets = vectors.getJSONObject("rulesets")
    val cases = vectors.getJSONArray("cases")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val name = case.optString("rules", "")
      @Suppress("UNCHECKED_CAST") // because the vector file holds JSON objects only
      val rules = if (case.isNull("rules")) null else toKotlin(rulesets.getJSONArray(name)) as List<Map<String, Any?>>
      val request = case.getJSONObject("request")
      val decision = NavigationRules.decide(
        rules,
        NavigationRules.Request(
          request.getString("url"),
          request.optBoolean("mainFrame", true),
          request.optBoolean("newWindow", false),
          request.optBoolean("userInitiated", false)
        )
      )
      val expect = case.getJSONObject("expect")
      val expected = NavigationRules.Decision(expect.getString("action"), if (expect.isNull("rule")) null else expect.getInt("rule"))
      assertEquals(case.getString("name"), expected, decision)
    }
  }
}
