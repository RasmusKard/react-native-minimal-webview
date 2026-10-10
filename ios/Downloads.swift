import WebKit

/// Downloads through WKDownload (the page's session and cookies), with the app's `onDownload`: `Content-Disposition:
/// attachment`, types WebKit cannot show, `<a download>` and blob: URLs. Files land in the app's temporary directory;
/// each finished download emits `download {uri, filename, mimeType, url}` for the app to share or move (expo-sharing,
/// expo-file-system), a failed one `download {filename, url, reason}`. `url` is the full http(s) URL, or null for data:
/// and blob: (the page made the file itself). Without the prop the core opens them externally.
final class Downloads: NSObject, WebViewExtension, WKDownloadDelegate {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?
  private var files: [ObjectIdentifier: (url: URL, mimeType: String)] = [:]

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  /// A main-frame response that is a file, not a page.
  static func isDownload(_ response: WKNavigationResponse) -> Bool {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    return response.isForMainFrame && (disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType)
  }

  func decidePolicy(for response: WKNavigationResponse) -> WKNavigationResponsePolicy? {
    handled && Self.isDownload(response) ? .download : nil
  }

  func wantsDownload(_ action: WKNavigationAction) -> Bool {
    handled && action.shouldPerformDownload
  }

  func didBecome(_ download: WKDownload) {
    if handled { download.delegate = self }
  }

  private var handled: Bool { host?.handles("download") == true }

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping @MainActor (URL?) -> Void
  ) {
    // The filename comes from the server or page: keep only its last path component.
    let name = (suggestedFilename as NSString).lastPathComponent
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent(name.isEmpty ? "download" : name)
    files[ObjectIdentifier(download)] = (file, response.mimeType ?? "application/octet-stream")
    completionHandler(file)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = files.removeValue(forKey: ObjectIdentifier(download)) else { return }
    host?.emit("download", [
      "uri": file.url.absoluteString, "filename": file.url.lastPathComponent, "mimeType": file.mimeType,
      "url": serverUrl(download)
    ])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let file = files.removeValue(forKey: ObjectIdentifier(download))
    host?.emit("download", [
      "filename": file?.url.lastPathComponent ?? "", "url": serverUrl(download),
      "reason": error.localizedDescription
    ])
  }

  /// The download's server URL for the events; null when the page generated the file (data:, blob:).
  private func serverUrl(_ download: WKDownload) -> Any {
    guard let url = download.originalRequest?.url, ["http", "https"].contains(url.scheme?.lowercased()) else { return NSNull() }
    return url.absoluteString
  }
}
