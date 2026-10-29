package expo.modules.minimalwebview

import android.webkit.ValueCallback
import expo.modules.minimalwebview.PlatformSettings.Target
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * `PlatformSettings.set` and `call` on a fake: a JS value coerced to each parameter type, the reason for each
 * rejection, and which overload `call` picks.
 */
class PlatformSettingsTest {
  private class Fake {
    val values = mutableListOf<Any?>()
    fun setInt(v: Int) { values += v }
    fun setLong(v: Long) { values += v }
    fun setFloat(v: Float) { values += v }
    fun setDouble(v: Double) { values += v }
    fun setFlag(v: Boolean) { values += v }
    fun setText(v: CharSequence?) { values += v }
    fun setTag(v: Any) { values += v }
    fun setUnsupported(v: Int): Unit = throw UnsupportedOperationException("$v")
    fun setFailing(v: Int): Unit = throw IllegalStateException("boom $v")
    var pending: ValueCallback<Boolean>? = null
    fun put(a: String, b: String) { values += "$a=$b" }
    fun put(a: String, b: String, done: ValueCallback<Boolean>?) { values += "$a=$b later"; pending = done }
    fun clear(done: ValueCallback<Boolean>?) { values += "clear"; pending = done }
    fun echo(v: Any?) = v
  }
  private object FakeCompat {
    @JvmStatic fun setZoom(fake: Fake, v: Int) { fake.values += v }
  }

  private fun set(key: String, value: Any?): Pair<String?, List<Any?>> {
    val fake = Fake()
    val targets = listOf(Target(Fake::class.java, fake, null), Target(FakeCompat::class.java, null, fake))
    return PlatformSettings.set(targets, key, value) to fake.values
  }

  @Test
  fun coerces() {
    assertEquals(null to listOf(1), set("int", 1.5)) // truncated
    assertEquals(null to listOf(2L), set("long", 2.0))
    assertEquals(null to listOf(0.5f), set("float", 0.5))
    assertEquals(null to listOf(3.0), set("double", 3)) // a JS integer can arrive as Int
    assertEquals(null to listOf(true), set("flag", true))
    assertEquals(null to listOf("hi"), set("text", "hi"))
    assertEquals(null to listOf(null), set("text", null))
    assertEquals(null to listOf(listOf(1)), set("tag", listOf(1))) // any other type takes an instance of it
    assertEquals(null to listOf(2), set("zoom", 2.0)) // a static compat method takes the leading object first
  }

  /** What `call` replied with, and whether a method fit. */
  private fun call(fake: Fake, name: String, vararg args: Any?): Pair<MutableList<String>, Boolean> {
    val replies = mutableListOf<String>()
    return replies to PlatformSettings.call(listOf(Target(Fake::class.java, fake, null)), name, args.toList()) { replies += it }
  }

  @Test
  fun callPrefersTheOverloadThatTakesTheArgs() {
    val fake = Fake()
    assertEquals(mutableListOf("null") to true, call(fake, "put", "a", "1"))
    assertEquals(mutableListOf("null") to true, call(fake, "put", "b", "2", null)) // null passes no callback
    assertEquals(listOf<Any?>("a=1", "b=2 later"), fake.values)
    assertEquals(null, fake.pending)
  }

  @Test
  fun callAwaitsATrailingValueCallbackLeftOutOfTheArgs() {
    val fake = Fake()
    val (replies, fits) = call(fake, "clear")
    assertEquals(true, fits)
    assertEquals(emptyList<String>(), replies) // not before the callback reports
    checkNotNull(fake.pending) { "call passed clear no callback" }.onReceiveValue(true)
    assertEquals(listOf("true"), replies)
  }

  @Test
  fun callOnlyAddsACallbackForAValueCallbackParameter() {
    val (replies, fits) = call(Fake(), "echo")
    assertFalse(fits)
    assertEquals(emptyList<String>(), replies)
    assertFalse(call(Fake(), "missing").second)
  }

  @Test
  fun rejects() {
    val none = emptyList<Any?>()
    assertEquals("no public setter takes a String" to none, set("int", "1"))
    assertEquals("no public setter takes a Boolean" to none, set("int", true))
    assertEquals("no public setter takes a Boolean" to none, set("tag", false)) // a boolean fits only a boolean
    assertEquals("no public setter takes a Double" to none, set("flag", 1.0))
    assertEquals("no public setter takes a null" to none, set("int", null))
    assertEquals("no public setter" to none, set("missing", 1))
    assertEquals("not a public setter" to none, set("_int", 1))
    assertEquals("owned by the core" to none, set("webViewClient", 1))
    assertEquals("not supported by this WebView" to none, set("unsupported", 1))
    assertEquals("failed: java.lang.IllegalStateException: boom 1" to none, set("failing", 1))
  }
}
