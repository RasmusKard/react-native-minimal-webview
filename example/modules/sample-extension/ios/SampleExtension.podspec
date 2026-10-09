Pod::Spec.new do |s|
  s.name           = 'SampleExtension'
  s.version        = '0.0.1'
  s.summary        = 'An out-of-package minimal-rn-webview extension'
  s.author         = ''
  s.homepage       = 'https://github.com/RasmusKard/minimal-rn-webview'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'MinimalWebView'
  s.source_files = "**/*.swift"
end
