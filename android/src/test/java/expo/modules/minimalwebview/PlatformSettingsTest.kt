package expo.modules.minimalwebview

import android.webkit.ValueCallback
import expo.modules.minimalwebview.PlatformSettings.Target
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * `PlatformSettings.apply`, `get` and `call` on a fake: a JS value coerced to each parameter type, the reason for each
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
    fun getUnsupported(): Int = throw UnsupportedOperationException()
    fun getNaN() = Double.NaN
    var pending: ValueCallback<Boolean>? = null
    fun put(a: String, b: String) { values += "$a=$b" }
    fun put(a: String, b: String, done: ValueCallback<Boolean>?) { values += "$a=$b later"; pending = done }
    fun clear(done: ValueCallback<Boolean>?) { values += "clear"; pending = done }
    var measured: ValueCallback<Double>? = null
    fun measure(done: ValueCallback<Double>?) { measured = done }
    fun echo(v: Any?) = v
  }
  private object FakeCompat {
    @JvmStatic fun setZoom(fake: Fake, v: Int) { fake.values += v }
  }

  private fun set(key: String, value: Any?): Pair<String?, List<Any?>> {
    val fake = Fake()
    val targets = listOf(Target(Fake::class.java, fake, null), Target(FakeCompat::class.java, null, fake))
    val rejected = PlatformSettings { if (it == "settings") targets else null }.apply(mapOf("settings" to mapOf(key to value)))
    return rejected.singleOrNull()?.get("reason") to fake.values
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

  /** A `settings` root over [fake]. */
  private fun rootOf(fake: Fake) = PlatformSettings { if (it == "settings") listOf(Target(Fake::class.java, fake, null)) else null }

  /** What `call` replied with; throws a [PlatformException] when no method fit. */
  private fun call(fake: Fake, name: String, vararg args: Any?): MutableList<String> {
    val replies = mutableListOf<String>()
    rootOf(fake).call("settings.$name", args.toList()) { replies += it() }
    return replies
  }

  @Test
  fun callPrefersTheOverloadThatTakesTheArgs() {
    val fake = Fake()
    assertEquals(listOf("null"), call(fake, "put", "a", "1"))
    assertEquals(listOf("null"), call(fake, "put", "b", "2", null)) // null passes no callback
    assertEquals(listOf<Any?>("a=1", "b=2 later"), fake.values)
    assertEquals(null, fake.pending)
  }

  @Test
  fun callAwaitsATrailingValueCallbackLeftOutOfTheArgs() {
    val fake = Fake()
    val replies = call(fake, "clear")
    assertEquals(emptyList<String>(), replies) // not before the callback reports
    checkNotNull(fake.pending) { "call passed clear no callback" }.onReceiveValue(true)
    assertEquals(listOf("true"), replies)
    // A reported value JSON can't carry rejects in the reply, where the caller can still handle it.
    call(fake, "measure")
    assertEquals("native_error", code { checkNotNull(fake.measured) { "no callback" }.onReceiveValue(Double.NaN) })
  }

  @Test
  fun callOnlyAddsACallbackForAValueCallbackParameter() {
    assertEquals("not_found", code { call(Fake(), "echo") })
    assertEquals("not_found", code { call(Fake(), "missing") })
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
    assertEquals("owned by the core" to none, set("onTouchListener", null))
    assertEquals("owned by the core" to none, set("onScrollChangeListener", null))
    assertEquals(
      "owned by the core: use AndroidWebView.setWebContentsDebuggingEnabled" to none,
      set("webContentsDebuggingEnabled", true)
    )
    assertEquals("not supported by this WebView" to none, set("unsupported", 1))
    assertEquals("failed: java.lang.IllegalStateException: boom 1" to none, set("failing", 1))
  }

  /** The JS error code `get`, `call` or `toJson` rejects with. */
  private fun code(body: () -> Unit) = assertThrows(PlatformException::class.java, body).code

  @Test
  fun getAndCallCodes() {
    val fake = Fake()
    val settings = rootOf(fake)
    val replies = mutableListOf<String>()
    settings.call("settings.setInt", listOf(1)) { replies += it() }
    assertEquals(listOf("null"), replies)
    assertEquals(listOf<Any?>(1), fake.values)
    assertEquals("not_found", code { settings.get("settings.missing") })
    assertEquals("not_found", code { settings.call("settings.missing", emptyList()) {} })
    assertEquals("not_found", code { settings.call("settings.setInt", listOf("1")) {} }) // no overload takes it
    assertEquals("not_found", code { settings.call("nope.setInt", listOf(1)) {} })
    assertEquals("not_found", code { settings.get("settings.destroy") }) // owned by the core, so never a getter
    assertEquals("native_error", code { settings.call("settings.destroy", emptyList()) {} })
    assertEquals("native_error", code { settings.call("settings.addNavigationListener", listOf(null)) {} })
    assertEquals("native_error", code { settings.call("settings.setFailing", listOf(1)) {} })
    assertEquals("unavailable", code { settings.get("settings.unsupported") })
    assertEquals("native_error", code { settings.get("settings.naN") })
  }

  @Test
  fun toJson() {
    assertEquals("1.5", PlatformSettings.toJson(1.5))
    assertEquals("null", PlatformSettings.toJson(Any()))
    assertEquals("native_error", code { PlatformSettings.toJson(Double.POSITIVE_INFINITY) })
    assertEquals("native_error", code { PlatformSettings.toJson(Float.NaN) })
    assertEquals("native_error", code { PlatformSettings.toJson(listOf(1, Double.NaN)) })
    assertEquals("native_error", code { PlatformSettings.toJson(mapOf("a" to listOf(Float.POSITIVE_INFINITY))) })
    assertEquals("""["a",[1,"b"],null]""", PlatformSettings.toJson(listOf("a", arrayOf(1, "b"), Any())))
    assertEquals("\"quoted\\\"\"", PlatformSettings.toJson("quoted\""))
    assertEquals("null", PlatformSettings.toJson(null))
  }

  /** A root whose keys have getters (`getFlag`, `getText`), except `blind`. */
  private class Live {
    var flag = false
    var text: String? = "start"
    val writes = mutableListOf<Int>()
    fun setBlind(v: Int) { writes += v }
  }

  private val live = Live()
  private val settings = PlatformSettings { root ->
    if (root == "settings") listOf(Target(Live::class.java, live, null)) else null
  }

  private fun apply(vararg entries: Pair<String, Any?>, force: Boolean = false) =
    settings.apply(mapOf("settings" to mapOf(*entries)), force)

  @Test
  fun restoresARemovedKey() {
    apply("flag" to true, "text" to "a")
    apply("text" to "b")
    assertEquals(false, live.flag)
    assertEquals("b", live.text)
    assertEquals(emptyList<Any>(), settings.apply(emptyMap())) // the whole root removed
    assertEquals("start", live.text) // the value before the first write, not the one before the last
  }

  @Test
  fun recapturesAKeyAddedAgain() {
    apply("text" to "a")
    apply()
    live.text = "a hook's"
    apply("text" to "b")
    apply()
    assertEquals("a hook's", live.text)
  }

  @Test
  fun forgetsWhatItCapturedOnANewWebView() {
    apply("text" to "a")
    live.text = "the new WebView's"
    apply("text" to "a", force = true)
    apply()
    assertEquals("the new WebView's", live.text)
  }

  @Test
  fun keepsAKeyWithNoGetterAndSaysSo() {
    apply("blind" to 1)
    val reason = "removed, but it has no getter to restore it from: it keeps its value until the WebView is recreated"
    assertEquals(listOf(mapOf("key" to "settings.blind", "reason" to reason)), apply())
    assertEquals(listOf(1), live.writes)
  }

  @Test
  fun leavesARejectedKeyAlone() {
    apply("flag" to 1.0)
    live.flag = true
    assertEquals(emptyList<Any>(), apply())
    assertEquals(true, live.flag)
  }
}
