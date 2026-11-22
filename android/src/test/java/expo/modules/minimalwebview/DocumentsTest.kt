package expo.modules.minimalwebview

import org.junit.Assert.assertEquals
import org.junit.Test

class DocumentsTest {
  private val heard = mutableListOf<String>()
  private val documents = Documents(core = { heard += "core $it" }, outsiders = { heard += "outsiders $it" })

  @Test
  fun theCoreHearsAnEndBeforeTheAsksAndHooks() {
    documents.end(DocumentEnd.COMMITTED)
    heard.clear()
    documents.end(DocumentEnd.COMMITTED)
    documents.end(DocumentEnd.CLOSING)
    assertEquals(listOf("core COMMITTED", "outsiders COMMITTED", "core CLOSING", "outsiders CLOSING"), heard)
  }

  @Test
  fun aThrowingHookDoesNotSkipTheCoresResets() {
    val throwing = Documents(core = { heard += "core $it" }, outsiders = { error("hook") })
    runCatching { throwing.end(DocumentEnd.CRASHED) }
    assertEquals(listOf("core CRASHED"), heard)
  }

  @Test
  fun theFirstCommitAfterMountOrACrashOpensADocumentAndEndsNone() {
    documents.end(DocumentEnd.COMMITTED)
    documents.end(DocumentEnd.CRASHED)
    documents.end(DocumentEnd.COMMITTED)
    assertEquals(listOf("core COMMITTED", "core CRASHED", "outsiders CRASHED", "core COMMITTED"), heard)
  }

  @Test
  fun jsHearsOfACrashBeforeTheStateThatEndsTheCutOffLoad() {
    reportCrash(gone = { heard += "gone" }, recover = { heard += "recover" }, stateChanged = { heard += "state" })
    assertEquals(listOf("gone", "recover", "state"), heard)
  }
}
