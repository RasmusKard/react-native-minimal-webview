import Foundation

enum DownloadName {
  static func safe(_ suggested: String) -> String {
    let name = suggested.replacingOccurrences(of: "/", with: "_")
    return name.isEmpty || name == "." || name == ".." ? "download" : name
  }
}
