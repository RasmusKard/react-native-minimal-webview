require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MinimalWebView'
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

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # the documentation catalog, which CocoaPods can't add as a source
    'OTHER_DOCC_FLAGS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/MinimalWebView.docc"',
  }

  # CocoaPods makes every header here public.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = "Tests/**/*"
end
