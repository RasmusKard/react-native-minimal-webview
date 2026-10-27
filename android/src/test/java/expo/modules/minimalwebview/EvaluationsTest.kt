package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

/** The `evaluate` bookkeeping: each evaluation settles once, and only the main frame's replies count. */
class EvaluationsTest {
  private val evaluations = Evaluations()
  private val results = mutableListOf<String>()

  private fun add() = evaluations.add { result ->
    results += result.fold({ "ok $it" }, { "${(it as EvaluateError).code}: ${it.message}" })
  }

  @Test
  fun `ids increase and are not reused after a Document end`() {
    assertEquals(listOf(0, 1), List(2) { add() })
    evaluations.failAll()
    assertEquals(2, add())
  }

  @Test
  fun `a main-frame reply settles its evaluation once, with the value or a script_error`() {
    val value = add()
    val error = add()
    evaluations.settle("[$error, null, \"TypeError: x is not a function\"]", mainFrame = true)
    evaluations.settle("[$value, \"{\\\"a\\\":1}\"]", mainFrame = true)
    evaluations.settle("[$value, \"2\"]", mainFrame = true)
    evaluations.fail(value, "late")
    assertEquals(listOf("script_error: TypeError: x is not a function", "ok {\"a\":1}"), results)
  }

  @Test
  fun `a subframe's reply, a malformed one and one for an unknown id are ignored`() {
    val id = add()
    evaluations.settle("[$id, \"1\"]", mainFrame = false)
    for (reply in listOf(null, "", "not json", "{}", "[]", "[99, \"1\"]")) evaluations.settle(reply, mainFrame = true)
    assertEquals(emptyList<String>(), results)
    evaluations.settle("[$id, \"1\"]", mainFrame = true)
    assertEquals(listOf("ok 1"), results)
  }

  @Test
  fun `a script that didn't run fails once`() {
    val id = add()
    evaluations.fail(id, "the script did not run (a syntax error?)")
    evaluations.fail(id, "again")
    evaluations.settle("[$id, \"1\"]", mainFrame = true)
    assertEquals(listOf("script_error: the script did not run (a syntax error?)"), results)
  }

  @Test
  fun `a Document end fails every waiting evaluation with navigated, and forgets them`() {
    val first = add()
    add()
    evaluations.failAll()
    evaluations.failAll()
    evaluations.settle("[$first, \"1\"]", mainFrame = true)
    assertEquals(List(2) { "navigated: the page navigated before the script finished" }, results)
  }
}
