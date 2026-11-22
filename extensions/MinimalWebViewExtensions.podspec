require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MinimalWebViewExtensions'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: package['repository'] }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MinimalWebView'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*/*.swift"
end
