require 'json'
pkg = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'lucida-analytics-react-native'
  s.version      = pkg['version']
  s.summary      = 'Lucida analytics native module for React Native (session replay wireframes, queue cipher, install attribution)'
  s.license      = pkg['license']
  s.homepage     = pkg['homepage']
  s.authors      = 'Lucida'
  s.platforms    = { :ios => '15.0' } # the bundled Lucida iOS SDK needs 15
  s.source       = { :git => 'https://github.com/lucidaanalytics/lucida-js.git', :tag => "v#{s.version}" }
  s.source_files = 'ios/*.{h,m,mm,swift}', 'ios/vendor/Lucida/**/*.swift' # the Lucida iOS SDK is bundled at pack time (scripts/vendor-native.mjs)
  s.frameworks = 'Network', 'Security', 'WebKit', 'MapKit', 'SwiftUI'
  s.weak_frameworks = 'AdServices'
  s.swift_version = '5.9'
  s.dependency 'React-Core'
end
