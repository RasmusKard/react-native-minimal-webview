# The `android` settings prop finds androidx.webkit's compat setters and getters by name (PlatformSettings.kt).
# R8 would otherwise strip or rename the ones the app's own code never calls.
-keep class androidx.webkit.WebSettingsCompat { public static *; }
-keep class androidx.webkit.WebViewCompat { public static *; }
