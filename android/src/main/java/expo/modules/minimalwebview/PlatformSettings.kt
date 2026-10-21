package expo.modules.minimalwebview

import android.webkit.CookieManager
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

/**
 * The `android` settings prop, `{ settings: {…}, webView: {…} }`, applied by name through reflection, so a public
 * setter this package doesn't know (one a newer SDK or androidx.webkit adds) needs no code here.
 * `settings.textZoom: 120` calls `WebSettings.setTextZoom(120)`, else `WebSettingsCompat.setTextZoom(settings, 120)`.
 * `webView.acceptThirdPartyCookies: true` calls `WebView.set…`, else `WebViewCompat.set…(webView, …)`, else
 * `CookieManager.set…(webView, …)`. [get] reads through the matching getter and [call] invokes a method; for those two,
 * `cookieManager` and `webStorage` (the process-wide instances) are roots as well.
 *
 * Only public SDK methods: `getMethods()` returns nothing else, and reflection on them is allowed. A key with no public
 * setter for the value's type, a feature this device's WebView lacks (`UnsupportedOperationException`) or a method the
 * core owns is reported and skipped; nothing here throws at the caller except [get] and [call], which reject.
 */
internal class PlatformSettings(private val owner: MinimalWebView) {
  /** `root.key` -> the last value applied or rejected, so an unchanged value is neither applied nor reported again. */
  private val applied = mutableMapOf<String, Any?>()

  /** A receiver (null for statics) and, for compat and CookieManager methods, the root object passed first. */
  private class Target(val cls: Class<*>, val receiver: Any?, val leading: Any?)

  /** Applies [settings]; returns the rejected keys with their reasons. [force] re-applies everything (a new WebView). */
  fun apply(settings: Map<String, Any?>?, force: Boolean = false): List<Map<String, String>> {
    if (force) applied.clear()
    val rejected = mutableListOf<Map<String, String>>()
    for ((rootName, entries) in settings.orEmpty()) {
      val targets = if (rootName == "settings" || rootName == "webView") targets(rootName) else null
      if (targets == null || entries !is Map<*, *>) {
        rejected += mapOf("key" to rootName, "reason" to "unknown root: use settings or webView")
        continue
      }
      for ((k, value) in entries) {
        val key = k as? String ?: continue
        val id = "$rootName.$key"
        if (applied.containsKey(id) && applied[id] == value) continue
        applied[id] = value
        val problem = set(targets, key, value) ?: continue
        rejected += mapOf("key" to id, "reason" to problem)
      }
    }
    return rejected
  }

  /** `root.key`: the getter's value (`getKey`, `isKey` or a non-void `key()`), as JSON. Throws with the reason. */
  fun get(path: String): String {
    val (targets, key) = resolve(path)
    if (key in OWNED) throw problem("$key is owned by the core")
    val capital = key.replaceFirstChar { it.uppercaseChar() }
    for (target in targets) {
      for (method in target.cls.methods) {
        val getter = method.name == "get$capital" || method.name == "is$capital"
        if (!getter && (method.name != key || method.returnType == Void.TYPE)) continue
        val args = arguments(method, target, emptyList()) ?: continue
        return toJson(invoke(method, target, args))
      }
    }
    throw problem("no public getter for $path")
  }

  /** `root.method` with [args]: a public method the core doesn't own, its result as JSON. Throws with the reason. */
  fun call(path: String, args: List<Any?>): String {
    val (targets, name) = resolve(path)
    if (name in OWNED) throw problem("$name is owned by the core")
    for (target in targets) {
      for (method in target.cls.methods) {
        if (method.name != name) continue
        val arguments = arguments(method, target, args) ?: continue
        return toJson(invoke(method, target, arguments))
      }
    }
    throw problem("no public method $path takes these arguments")
  }

  /** The targets of `root.key` and the key; throws for a malformed path or an unknown root. */
  private fun resolve(path: String): Pair<List<Target>, String> {
    val parts = path.split('.', limit = 2)
    if (parts.size != 2) throw problem("use root.key")
    return (targets(parts[0]) ?: throw problem("unknown root: use settings, webView, cookieManager or webStorage")) to parts[1]
  }

  private fun targets(root: String): List<Target>? = when (root) {
    "settings" -> listOf(
      Target(WebSettings::class.java, owner.webView.settings, null),
      Target(WebSettingsCompat::class.java, null, owner.webView.settings)
    )
    "webView" -> listOf(
      Target(WebView::class.java, owner.webView, null),
      Target(WebViewCompat::class.java, null, owner.webView),
      Target(CookieManager::class.java, CookieManager.getInstance(), owner.webView)
    )
    "cookieManager" -> listOf(Target(CookieManager::class.java, CookieManager.getInstance(), null))
    "webStorage" -> listOf(Target(WebStorage::class.java, WebStorage.getInstance(), null))
    else -> null
  }

  private fun set(targets: List<Target>, key: String, value: Any?): String? {
    if (key.isEmpty() || key.startsWith("_")) return "not a public setter"
    val setter = "set" + key.replaceFirstChar { it.uppercaseChar() }
    if (setter in OWNED) return "owned by the core"
    var seen = false
    for (target in targets) {
      for (method in target.cls.methods) {
        if (method.name != setter) continue
        seen = true
        val args = arguments(method, target, listOf(value)) ?: continue
        return try {
          invoke(method, target, args)
          null
        } catch (e: IllegalArgumentException) {
          e.message
        }
      }
    }
    return if (seen) "no public setter takes a ${value?.javaClass?.simpleName ?: "null"}" else "no public setter"
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

  /** [value] as the parameter [type] takes it, or [NONE]. JS numbers arrive as Double (or Int) and fit every numeric type. */
  private fun coerce(value: Any?, type: Class<*>): Any? = when {
    value == null -> if (type.isPrimitive) NONE else null
    type == Boolean::class.javaPrimitiveType || type == Boolean::class.javaObjectType -> value as? Boolean ?: NONE
    value is Boolean -> NONE
    type == Int::class.javaPrimitiveType || type == Int::class.javaObjectType -> (value as? Number)?.toInt() ?: NONE
    type == Long::class.javaPrimitiveType || type == Long::class.javaObjectType -> (value as? Number)?.toLong() ?: NONE
    type == Float::class.javaPrimitiveType || type == Float::class.javaObjectType -> (value as? Number)?.toFloat() ?: NONE
    type == Double::class.javaPrimitiveType || type == Double::class.javaObjectType -> (value as? Number)?.toDouble() ?: NONE
    type == String::class.java || type == CharSequence::class.java -> value as? String ?: NONE
    type.isInstance(value) -> value
    else -> NONE
  }

  /** Invokes, unwrapping the target's own exception; a compat feature this WebView lacks reads as unsupported. */
  private fun invoke(method: Method, target: Target, args: Array<Any?>): Any? = try {
    method.invoke(target.receiver, *args)
  } catch (e: InvocationTargetException) {
    val cause = e.cause ?: e
    throw problem(if (cause is UnsupportedOperationException) "not supported by this WebView" else "failed: $cause")
  } catch (e: IllegalAccessException) {
    throw problem("not accessible: ${e.message}")
  }

  private fun problem(reason: String) = IllegalArgumentException(reason)

  internal companion object {
    val NONE = Any()

    /**
     * Methods the core owns: its clients, listeners, scripts, loads and navigations, and the WebView's lifetime and timers;
     * the page's JS goes through `evaluate` and the bridge.
     */
    val OWNED = setOf(
      "setWebViewClient", "setWebChromeClient", "setDownloadListener", "addJavascriptInterface",
      "removeJavascriptInterface", "addWebMessageListener", "removeWebMessageListener", "addDocumentStartJavaScript",
      "destroy", "removeAllViews", "pauseTimers", "resumeTimers", "loadUrl", "loadData", "loadDataWithBaseURL",
      "postUrl", "reload", "goBack", "goForward", "goBackOrForward", "stopLoading", "evaluateJavascript"
    )

    /** A getter's or method's result as JSON: primitives, strings, lists and maps of them; anything else is null. */
    fun toJson(value: Any?): String = when (value) {
      null, is Unit -> "null"
      is Boolean, is Number -> value.toString()
      is String -> JSONObject.quote(value)
      is Map<*, *> -> JSONObject(value.mapKeys { it.key.toString() }.mapValues { jsonable(it.value) }).toString()
      is List<*> -> JSONArray(value.map(::jsonable)).toString()
      is Array<*> -> JSONArray(value.map(::jsonable)).toString()
      else -> "null"
    }

    private fun jsonable(value: Any?): Any? = when (value) {
      is Boolean, is Number, is String -> value
      is Map<*, *> -> JSONObject(value.mapKeys { it.key.toString() }.mapValues { jsonable(it.value) })
      is List<*> -> JSONArray(value.map(::jsonable))
      else -> JSONObject.NULL
    }
  }
}
