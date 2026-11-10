import Foundation

/// The name a download is saved under, in a directory of its own.
enum DownloadName {
  /// The server's or the page's name for the file, kept in its directory as on Android (`URLUtilCompat.guessFileName`,
  /// then `Downloads.safeName`): each `/` becomes `_`, and a name that is a directory (`.`, `..`) or empty becomes
  /// `download`.
  static func safe(_ suggested: String) -> String {
    let name = suggested.replacingOccurrences(of: "/", with: "_")
    return name.isEmpty || name == "." || name == ".." ? "download" : name
  }
}
