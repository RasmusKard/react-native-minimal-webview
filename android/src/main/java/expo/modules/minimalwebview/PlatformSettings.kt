package expo.modules.minimalwebview

import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import kotlin.math.truncate

/**
 * The `android` settings prop, `get` and `call`, by name through reflection over public SDK methods only
 * (`getMethods()`), so a setter a newer SDK or androidx.webkit adds needs no code here. The roots and their order:
 * [Companion.targets].
 */
internal class PlatformSettings(
  private val hasNavigationListener: () -> Boolean = { true },
  private val targets: (root: String) -> List<Target>?
) {
  /** `root.key` -> the last value applied or rejected, so an unchanged value is neither applied nor reported again. */
  private val applied = mutableMapOf<String, Any?>()

  /** `root.key` -> its getter's value before the first write ([NONE]: no getter), set back when the key is removed. */
  private val originals = mutableMapOf<String, Any?>()

  /** A receiver (null for statics) and, for compat and CookieManager methods, the root object passed first. */
  internal class Target(val cls: Class<*>, val receiver: Any?, val leading: Any?)

  /**
   * Applies [settings], and sets a key applied before and missing now back to its value before the first write;
   * returns the rejected keys with their reasons. [force] re-applies everything (a new WebView).
   */
  fun apply(settings: Map<String, Any?>?, force: Boolean = false): List<Map<String, String>> {
    if (force) {
      applied.clear()
      originals.clear()
    }
    // Before the new values, so restoring one can't undo another that depends on it.
    val rejected = restore(removedFrom = settings.orEmpty()).toMutableList()
    for ((rootName, entries) in settings.orEmpty()) {
      val targets = settingsTargets(rootName)
      if (targets == null || entries !is Map<*, *>) {
        rejected += mapOf("key" to rootName, "reason" to "unknown root: use settings or webView")
        continue
      }
      for ((k, value) in entries) {
        val key = k as? String ?: continue
        val id = "$rootName.$key"
        if (applied.containsKey(id) && applied[id] == value) continue
        applied[id] = value
        val problem = write(targets, id, key, value) ?: continue
        rejected += mapOf("key" to id, "reason" to problem)
      }
    }
    return rejected
  }

  /** The targets of a root the prop has, `settings` or `webView`; null for another. */
  private fun settingsTargets(rootName: String) =
    // Not targets() first: the other roots are the WebView profile's, which `webView.profile` may not have set yet.
    if (rootName in listOf("settings", "webView")) targets(rootName) else null

  /** [set], keeping the value it replaces the first time under [id]; returns the problem, or null when it was set. */
  private fun write(targets: List<Target>, id: String, key: String, value: Any?): String? {
    refusal(setterOf(key), listOf(value))?.let { return it }
    if (id in originals) return set(targets, key, value)
    return set(targets, key, value) {
      originals[id] = runCatching { read(targets, key) }.getOrDefault(NONE)
    }?.also { originals.remove(id) }
  }

  /** Forgets each applied key [removedFrom] no longer has and sets its original value back; returns what failed. */
  private fun restore(removedFrom: Map<String, Any?>): List<Map<String, String>> {
    val present = removedFrom.flatMap { (rootName, entries) ->
      (entries as? Map<*, *>)?.keys.orEmpty().map { "$rootName.$it" }
    }.toSet()
    return (applied.keys - present).mapNotNull { id ->
      applied.remove(id)
      if (id !in originals) return@mapNotNull null
      val original = originals.remove(id)
      val (rootName, key) = id.split('.', limit = 2)
      // shortcut: a setter with no getter (geolocationEnabled, initialScale, backgroundColor) can't be restored; add
      // the platform's defaults for those if one matters.
      val problem = if (original === NONE) {
        "removed, but it has no getter to restore it from: it keeps its value until the WebView is recreated"
      } else {
        set(targets(rootName).orEmpty(), key, original)?.let { "removed, but restoring it failed: $it" }
      }
      problem?.let { mapOf("key" to id, "reason" to it) }
    }
  }

  /** `root.key`: the getter's value (`getKey`, `isKey` or a non-void `key()`), as JSON. Throws a [PlatformException]. */
  fun get(path: String): String {
    val (targets, key) = resolve(path)
    val value = read(targets, key)
    if (value === NONE) throw notFound("no public getter for $key")
    return toJson(value)
  }

  /**
   * `root.method` with [args], a public method the core doesn't own. [reply] gets a function that returns the result as
   * JSON, or throws a [PlatformException] for a value JSON can't carry. The result is the method's return value or, when
   * no overload takes just [args], the value that the first overload with a trailing `ValueCallback` reports later.
   * Throws a [PlatformException].
   */
  fun call(path: String, args: List<Any?>, reply: (() -> String) -> Unit) {
    val (targets, name) = resolve(path)
    if (name in OWNED) throw problem("$name is ${owned(name)}")
    refusal(name, args)?.let { throw PlatformException("unavailable", it) }
    val direct = find(targets, args) { it.name == name }
    if (direct != null) {
      val result = direct()
      return reply { toJson(result) }
    }
    // The callback runs later, outside the caller's try: the receiver converts, so it can reject instead of crashing.
    val callback = ValueCallback<Any?> { value -> reply { toJson(value) } }
    val awaiting = find(targets, args + callback) {
      it.name == name && it.parameterTypes.lastOrNull() == ValueCallback::class.java
    } ?: throw notFound("no public method $path takes these arguments")
    awaiting()
  }

  /** The targets of `root.key` and the key; throws for a malformed path or an unknown root. */
  private fun resolve(path: String): Pair<List<Target>, String> {
    val parts = path.split('.', limit = 2)
    if (parts.size != 2) throw notFound("use root.key")
    return (targets(parts[0]) ?: throw notFound("unknown root: use settings, webView, cookieManager or webStorage")) to parts[1]
  }

  /** Why [method] can't take [args] on this WebView, or null. */
  private fun refusal(method: String, args: List<Any?>) =
    // Without NavigationListener the clients end a load at onPageFinished, which WebView 133 skips for a restored page.
    if (method == "setBackForwardCacheEnabled" && args == listOf(true) && !hasNavigationListener()) {
      "not supported by this WebView: below Android System WebView 146 a page restored from the cache reports no load end"
    } else {
      null
    }

  internal companion object {
    private val NONE = Any()

    private fun setterOf(key: String) = "set" + key.replaceFirstChar { it.uppercaseChar() }

    /** The targets of [root] on [webView], or null for an unknown root. */
    fun targets(webView: WebView, root: String): List<Target>? = when (root) {
      "settings" -> listOf(
        Target(WebSettings::class.java, webView.settings, null),
        Target(WebSettingsCompat::class.java, null, webView.settings)
      )
      "webView" -> listOf(
        Target(WebView::class.java, webView, null),
        Target(WebViewCompat::class.java, null, webView),
        // Any instance: its (webView, …) methods set the WebView's own settings.
        Target(CookieManager::class.java, CookieManager.getInstance(), webView)
      )
      "cookieManager" -> listOf(Target(CookieManager::class.java, profileOf(webView)?.cookieManager ?: CookieManager.getInstance(), null))
      "webStorage" -> listOf(Target(WebStorage::class.java, profileOf(webView)?.webStorage ?: WebStorage.getInstance(), null))
      else -> null
    }

    /**
     * Methods the core owns: its clients, listeners, scripts, loads and navigations, the WebView's lifetime and timers,
     * and the process-wide debugging switch; the page's JS goes through `evaluate` and the bridge.
     */
    val OWNED = setOf(
      "setWebViewClient", "setWebChromeClient", "setDownloadListener", "addJavascriptInterface",
      "removeJavascriptInterface", "addWebMessageListener", "removeWebMessageListener", "addDocumentStartJavaScript",
      "destroy", "removeAllViews", "pauseTimers", "resumeTimers", "loadUrl", "loadData", "loadDataWithBaseURL",
      "postUrl", "reload", "goBack", "goForward", "goBackOrForward", "stopLoading", "evaluateJavascript",
      "setWebContentsDebuggingEnabled", "setOnTouchListener", "setOnScrollChangeListener", "addNavigationListener"
    )

    /** The first method of [targets], target by target, that [accepts] and takes [values], bound to them; or null. */
    private fun find(targets: List<Target>, values: List<Any?>, accepts: (Method) -> Boolean): (() -> Any?)? {
      for (target in targets) {
        for (method in target.cls.methods) {
          if (!accepts(method)) continue
          val args = arguments(method, target, values) ?: continue
          return { invoke(method, target, args) }
        }
      }
      return null
    }

    private fun owned(name: String) =
      if (name == "setWebContentsDebuggingEnabled") {
        "owned by the core: use AndroidWebView.setWebContentsDebuggingEnabled"
      } else {
        "owned by the core"
      }

    /**
     * Calls [key]'s setter on the first target that takes [value], running [before] just before it; returns the
     * problem, or null when it was set.
     */
    private fun set(targets: List<Target>, key: String, value: Any?, before: () -> Unit = {}): String? {
      if (key.isEmpty() || key.startsWith("_")) return "not a public setter"
      val setter = setterOf(key)
      if (setter in OWNED) return owned(setter)
      val apply = find(targets, listOf(value)) { it.name == setter } ?: return when {
        targets.none { t -> t.cls.methods.any { it.name == setter } } -> "no public setter"
        else -> "no public setter takes a ${value?.javaClass?.simpleName ?: "null"}"
      }
      return try {
        before()
        apply()
        null
      } catch (e: IllegalArgumentException) { // a PlatformException from invoke is one, so its reason is the message
        e.message
      }
    }

    /** The value of [key]'s getter on the first target that has one, or [NONE]. */
    private fun read(targets: List<Target>, key: String): Any? {
      val capital = key.replaceFirstChar { it.uppercaseChar() }
      val getter = find(targets, emptyList()) {
        it.name == "get$capital" || it.name == "is$capital" || (it.name == key && it.returnType != Void.TYPE)
      } ?: return NONE
      return getter()
    }

    /** The method's arguments for [values], with the target's leading object first, or null when they don't fit. */
    private fun arguments(method: Method, target: Target, values: List<Any?>): Array<Any?>? {
      if (target.receiver == null && !Modifier.isStatic(method.modifiers)) return null
      val types = method.parameterTypes
      val leading = if (target.leading != null) listOf(target.leading) else emptyList()
      if (types.size != leading.size + values.size) return null
      if (leading.isNotEmpty() && !types[0].isInstance(target.leading)) return null
      val args = arrayOfNulls<Any?>(types.size)
      leading.forEachIndexed { i, value -> args[i] = value }
      values.forEachIndexed { i, value ->
        val coerced = coerce(value, types[leading.size + i])
        if (coerced === NONE) return null
        args[leading.size + i] = coerced
      }
      return args
    }

    /** [value] as the parameter [type] takes it, or [NONE]. JS numbers arrive as Double and fit every numeric type. */
    private fun coerce(value: Any?, type: Class<*>): Any? {
      if (value == null) return if (type.isPrimitive) NONE else null
      return when (type.kotlin.javaObjectType) {
        Boolean::class.javaObjectType -> value as? Boolean
        Int::class.javaObjectType -> (value as? Number)?.let(::intOf)
        Long::class.javaObjectType -> (value as? Number)?.toLong()
        Float::class.javaObjectType -> (value as? Number)?.toFloat()
        Double::class.javaObjectType -> (value as? Number)?.toDouble()
        String::class.java, CharSequence::class.java -> value as? String
        else -> if (value !is Boolean && type.isInstance(value)) value else null
      } ?: NONE
    }

    /**
     * [number] truncated to an int, or null outside `Int.MIN_VALUE..0xFFFFFFFF`. Above `Int.MAX_VALUE` it wraps, as
     * Java's `(int) 0xFF000000L` does, so an ARGB color written as JS writes it, `0xFF000000`, is `-16777216`.
     * Kotlin's `Double.toInt()` would clamp it to `Int.MAX_VALUE`.
     */
    private fun intOf(number: Number): Int? {
      val whole = truncate(number.toDouble())
      return if (whole >= Int.MIN_VALUE && whole <= UInt.MAX_VALUE.toDouble()) whole.toLong().toInt() else null
    }

    /** Invokes, unwrapping the target's own exception; a compat feature this WebView lacks reads as unsupported. */
    private fun invoke(method: Method, target: Target, args: Array<Any?>): Any? = try {
      method.invoke(target.receiver, *args)
    } catch (e: InvocationTargetException) {
      val cause = e.cause ?: e
      throw if (cause is UnsupportedOperationException) {
        PlatformException("unavailable", "not supported by this WebView")
      } else {
        problem("failed: $cause")
      }
    } catch (e: IllegalAccessException) {
      throw problem("not accessible: ${e.message}")
    }

    private fun problem(reason: String) = PlatformException("native_error", reason)

    private fun notFound(reason: String) = PlatformException("not_found", reason)

    /**
     * A getter's or method's result as JSON: primitives, strings, collections and maps of them; anything else is null.
     * A non-finite number throws: JSON has none.
     */
    fun toJson(value: Any?): String = jsonable(value).let { if (it is String) JSONObject.quote(it) else it.toString() }

    // Checked here at every depth: Android's org.json turns a nested non-finite number into a null toString().
    private fun jsonable(value: Any?): Any = when (value) {
      is Double, is Float -> if ((value as Number).toDouble().isFinite()) value else throw problem("$value is not JSON")
      is Boolean, is Number, is String -> value
      is Map<*, *> -> JSONObject(value.mapKeys { it.key.toString() }.mapValues { jsonable(it.value) })
      is Collection<*> -> JSONArray(value.map(::jsonable))
      is Array<*> -> JSONArray(value.map(::jsonable))
      else -> JSONObject.NULL
    }
  }
}

/** Why [PlatformSettings.get] or [PlatformSettings.call] failed; [code] is the JS error code (`not_found`, `native_error` or `unavailable`). */
internal class PlatformException(val code: String, message: String) : IllegalArgumentException(message)
