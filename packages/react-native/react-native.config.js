// Autolinking uses the podspec at the package root and android/ with its build.gradle; paths are the defaults, stated explicitly.
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: { sourceDir: "./android", packageImportPath: "import com.lucida.reactnative.LucidaReactPackage;", packageInstance: "new LucidaReactPackage()" },
    },
  },
};
