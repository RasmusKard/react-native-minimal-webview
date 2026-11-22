package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

class DocumentsTest {
  private val heard = mutableListOf<String>()
  private val documents = Documents(core = { heard += "core $it" }, asksAndHooks = { heard += "asksAndHooks $it" })

  @Test
  fun theCoreHearsAnEndBeforeTheAsksAndHooks() {
    documents.end(DocumentEnd.COMMITTED)
    heard.clear()
    documents.end(DocumentEnd.COMMITTED)
    documents.end(DocumentEnd.CLOSING)
    assertEquals(listOf("core COMMITTED", "asksAndHooks COMMITTED", "core CLOSING", "asksAndHooks CLOSING"), heard)
  }

  @Test
  fun aThrowingHookDoesNotSkipTheCoresResets() {
    val throwing = Documents(core = { heard += "core $it" }, asksAndHooks = { error("hook") })
    runCatching { throwing.end(DocumentEnd.CRASHED) }
    assertEquals(listOf("core CRASHED"), heard)
  }

  @Test
  fun theFirstCommitAfterMountOrACrashOpensADocumentAndEndsNone() {
    documents.end(DocumentEnd.COMMITTED)
    documents.end(DocumentEnd.CRASHED)
    documents.end(DocumentEnd.COMMITTED)
    assertEquals(listOf("core COMMITTED", "core CRASHED", "asksAndHooks CRASHED", "core COMMITTED"), heard)
  }
}
