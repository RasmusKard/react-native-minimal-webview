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
  repository = package['repository']
  s.source         = { git: repository.is_a?(Hash) ? repository['url'] : repository } # npm pkg fix makes it a Hash
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # the documentation catalog, which CocoaPods can't add as a source
    'OTHER_DOCC_FLAGS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/MinimalWebView.docc"',
  }

  # Every header here is public, so the Objective-C helpers are NS_REFINED_FOR_SWIFT: Swift sees them as __MRW…,
  # which keeps them out of the Swift API reference.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = "Tests/**/*"
end
