package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

class DocumentScopeTest {
  @Test
  fun `every registrant hears each end once, in registration order`() {
    val scope = DocumentScope()
    val heard = mutableListOf<String>()
    scope.register { heard += "a:$it" }
    scope.register { heard += "b:$it" }
    scope.end(DocumentEnd.COMMITTED)
    scope.end(DocumentEnd.CRASHED)
    assertEquals(listOf("a:COMMITTED", "b:COMMITTED", "a:CRASHED", "b:CRASHED"), heard)
  }

  @Test
  fun `a registrant added after an end hears the next one`() {
    val scope = DocumentScope()
    val heard = mutableListOf<DocumentEnd>()
    scope.end(DocumentEnd.COMMITTED)
    scope.register { heard += it }
    scope.end(DocumentEnd.CLOSING)
    assertEquals(listOf(DocumentEnd.CLOSING), heard)
  }

  @Test
  fun `a skipsOpening registrant doesn't hear the commit that opens a Document with none open`() {
    val scope = DocumentScope()
    val skipped = mutableListOf<DocumentEnd>()
    val plain = mutableListOf<DocumentEnd>()
    scope.register(skipsOpening = true) { skipped += it }
    scope.register { plain += it }
    val ends = listOf(
      DocumentEnd.COMMITTED, DocumentEnd.COMMITTED, DocumentEnd.CRASHED, DocumentEnd.CRASHED,
      DocumentEnd.COMMITTED, DocumentEnd.COMMITTED, DocumentEnd.CLOSING
    )
    ends.forEach(scope::end)
    val expected = listOf(
      DocumentEnd.COMMITTED, DocumentEnd.CRASHED, DocumentEnd.CRASHED, DocumentEnd.COMMITTED, DocumentEnd.CLOSING
    )
    assertEquals(expected, skipped)
    assertEquals(ends, plain)
  }
}
