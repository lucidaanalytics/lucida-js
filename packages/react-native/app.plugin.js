// Expo config plugin. Native linking is done by autolinking (podspec + android/build.gradle), so this only sets safe defaults.
// `@expo/config-plugins` is an optional peer: it is loaded lazily and the plugin is a no-op without it.
let plugins;
try {
  plugins = require("@expo/config-plugins");
} catch {
  plugins = null;
}

// Play Install Referrer (Android install attribution) is declared in android/build.gradle; the iOS AdServices
// framework is weak-linked by the Swift module (`canImport(AdServices)`), so no project edits are required.
module.exports = function withLucida(config) {
  if (!plugins) return config;
  return plugins.createRunOncePlugin(
    (c) => c,
    "@lucida-analytics/react-native",
    require("./package.json").version,
  )(config);
};
