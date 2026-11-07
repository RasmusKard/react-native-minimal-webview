package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

/** The ask contract: each ask is answered once, by JS or with null when native gives up. */
class AsksTest {
  private val sent = mutableListOf<Map<String, Any?>>()
  private val asks = Asks { sent += it }
  private val answers = mutableListOf<Any?>()

  private fun ask() = asks.ask("hook", "q", mapOf("a" to 1)) { answers += it }

  private fun cancelled(id: Int) = mapOf("key" to "core", "name" to "askCancelled", "payload" to mapOf("askId" to id))

  @Test
  fun `an ask goes to JS with its id, and its first answer is the only one`() {
    val id = ask()
    asks.answer(id, "yes")
    asks.answer(id, "late")
    assertEquals(listOf(mapOf("key" to "hook", "name" to "q", "payload" to mapOf("a" to 1), "askId" to id)), sent)
    assertEquals(listOf<Any?>("yes"), answers)
  }

  @Test
  fun `a cancelled ask answers null and tells JS, and a late answer is dropped`() {
    val id = ask()
    asks.cancel(id)
    asks.answer(id, "late")
    asks.cancel(id)
    assertEquals(cancelled(id), sent.last())
    assertEquals(listOf<Any?>(null), answers)
  }

  @Test
  fun `a Document end answers every ask null, telling JS except at closing`() {
    val first = ask()
    asks.documentEnded(DocumentEnd.COMMITTED)
    val second = ask()
    asks.documentEnded(DocumentEnd.CLOSING)
    assertEquals(listOf(cancelled(first)), sent.filter { it["key"] == "core" && it["name"] == "askCancelled" })
    assertEquals(listOf<Any?>(null, null), answers)
    asks.answer(second, "late")
    assertEquals(2, answers.size)
  }

  @Test
  fun `an ask after closing answers null at once and sends nothing`() {
    asks.documentEnded(DocumentEnd.CLOSING)
    ask()
    assertEquals(listOf<Any?>(null), answers)
    assertEquals(emptyList<Map<String, Any?>>(), sent)
  }
}
