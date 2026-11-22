package expo.modules.minimalwebviewextensions

import android.app.DownloadManager as SystemDownloadManager
import android.net.Uri
import android.os.Environment
import android.util.Log
import android.widget.Toast
import androidx.webkit.URLUtilCompat
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The hook behind `downloadManager()`. The public Downloads folder needs no permission on API 29+, the package's
 * minSdk.
 */
internal object DownloadManager {
  const val KEY = "@react-native-minimal-webview/extensions.downloadManager"
  private val FILE_NAME_FORBIDDEN_CHARS = Regex("[\\\\/%\"]")

  fun register() = MinimalWebViewHooks.register(KEY) { webView, context ->
    context.onDownloadStart { url, userAgent, contentDisposition, mimeType, _ ->
      if (!url.startsWith("http:") && !url.startsWith("https:")) return@onDownloadStart false
      val name = URLUtilCompat.guessFileName(url, contentDisposition.ifEmpty { null }, mimeType).replace(FILE_NAME_FORBIDDEN_CHARS, "_")
      try {
        val request = SystemDownloadManager.Request(Uri.parse(url))
          .setTitle(name)
          .setNotificationVisibility(SystemDownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
          .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
          .addRequestHeader("User-Agent", userAgent)
        if (mimeType.isNotEmpty()) request.setMimeType(mimeType)
        cookieManager(webView).getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
        webView.context.getSystemService(SystemDownloadManager::class.java).enqueue(request)
      } catch (e: RuntimeException) {
        // A disabled Download Manager fails in setDestinationInExternalPublicDir (a NullPointerException) or enqueue.
        Log.w("MinimalWebViewExtensions", "downloadManager: the Download Manager refused the download", e)
        return@onDownloadStart false
      }
      val message = (context.options as? Map<*, *>)?.get("downloadingMessage") as? String
      Toast.makeText(webView.context, message ?: "Downloading", Toast.LENGTH_LONG).show()
      true
    }
  }
}
