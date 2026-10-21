package expo.modules.minimalwebview

import expo.modules.minimalwebview.DocumentScope.End
import org.junit.Assert.assertEquals
import org.junit.Test

class DocumentScopeTest {
  @Test
  fun `every registrant hears each end once, in registration order`() {
    val scope = DocumentScope()
    val heard = mutableListOf<String>()
    scope.register { heard += "a:$it" }
    scope.register { heard += "b:$it" }
    scope.end(End.COMMITTED)
    scope.end(End.CRASHED)
    assertEquals(listOf("a:COMMITTED", "b:COMMITTED", "a:CRASHED", "b:CRASHED"), heard)
  }

  @Test
  fun `a registrant added after an end hears the next one`() {
    val scope = DocumentScope()
    val heard = mutableListOf<End>()
    scope.end(End.COMMITTED)
    scope.register { heard += it }
    scope.end(End.CLOSING)
    assertEquals(listOf(End.CLOSING), heard)
  }
}
