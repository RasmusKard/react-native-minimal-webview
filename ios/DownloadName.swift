import Foundation

/// The name a download is saved under, in a directory of its own.
enum DownloadName {
  /// `suggested` with each `/` replaced by `_`; a result that is empty, `.` or `..` becomes `download`, as on Android (`URLUtilCompat.guessFileName`, then `Downloads.safeName`).
  static func safe(_ suggested: String) -> String {
    let name = suggested.replacingOccurrences(of: "/", with: "_")
    return name.isEmpty || name == "." || name == ".." ? "download" : name
  }
}
