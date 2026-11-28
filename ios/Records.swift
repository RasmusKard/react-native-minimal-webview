import ExpoModulesCore

// Expo drops a prop that fails to convert whole (ExpoFabricView's try?).

struct WebViewSource: Record {
  @Field var uri: String? = nil
  @Field var headers: [String: String]? = nil
  @Field var body: String? = nil
  @Field var readAccessRoot: String? = nil
  @Field var html: String? = nil
  @Field var baseUrl: String? = nil
}

struct InjectedScript: Record {
  @Field var code: String? = nil
  @Field var allFrames: Bool? = nil
}

