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
  repository = package['repository']
  s.source         = { git: repository.is_a?(Hash) ? repository['url'] : repository } # npm pkg fix makes it a Hash
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MinimalWebView'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # The module in src/ and one sub-folder per extension; nothing deeper (node_modules, build).
  s.source_files = "*/*.swift"
end
