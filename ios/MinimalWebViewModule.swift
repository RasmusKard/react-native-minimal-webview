import ExpoModulesCore

public class MinimalWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebView")

    AsyncFunction("setValueAsync") { (value: String) in
      // create-expo-module placeholder, replaced in Phase 0
    }

    View(MinimalWebView.self) {
      Events("onTap")
    }
  }
}
