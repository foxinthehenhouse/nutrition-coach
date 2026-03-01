module.exports = function (api) {
  // #region agent log
  const debugLog = (hypothesisId, message, data) => {
    fetch("http://127.0.0.1:7879/ingest/9623636f-8afd-4f75-a7c6-c664faa2cca4", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "72e22a",
      },
      body: JSON.stringify({
        sessionId: "72e22a",
        runId: "pre-fix",
        hypothesisId,
        location: "moment/babel.config.js",
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  };

  const pkgVersion = (name) => {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(`${name}/package.json`).version;
    } catch {
      return null;
    }
  };

  const resolveOrNull = (name) => {
    try {
      return require.resolve(name);
    } catch {
      return null;
    }
  };

  debugLog("H1", "babel_config_loaded", {
    cwd: process.cwd(),
    file: __filename,
  });
  // #region agent log
  console.error(
    "[DBG72e22a][H1] babel_config_loaded",
    JSON.stringify({ cwd: process.cwd(), file: __filename })
  );
  // #endregion
  debugLog("H2", "dependency_versions", {
    expoRouter: pkgVersion("expo-router"),
    nativewind: pkgVersion("nativewind"),
    cssInterop: pkgVersion("react-native-css-interop"),
    reanimated: pkgVersion("react-native-reanimated"),
    worklets: pkgVersion("react-native-worklets"),
  });
  // #region agent log
  console.error(
    "[DBG72e22a][H2] dependency_versions",
    JSON.stringify({
      expoRouter: pkgVersion("expo-router"),
      nativewind: pkgVersion("nativewind"),
      cssInterop: pkgVersion("react-native-css-interop"),
      reanimated: pkgVersion("react-native-reanimated"),
      worklets: pkgVersion("react-native-worklets"),
    })
  );
  // #endregion
  debugLog("H3", "resolver_checks", {
    workletsPlugin: resolveOrNull("react-native-worklets/plugin"),
    reanimatedPlugin: resolveOrNull("react-native-reanimated/plugin"),
    expoRouterEntry: resolveOrNull("expo-router/entry"),
  });
  // #region agent log
  console.error(
    "[DBG72e22a][H3] resolver_checks",
    JSON.stringify({
      workletsPlugin: resolveOrNull("react-native-worklets/plugin"),
      reanimatedPlugin: resolveOrNull("react-native-reanimated/plugin"),
      expoRouterEntry: resolveOrNull("expo-router/entry"),
    })
  );
  // #endregion
  // #endregion

  api.cache(true);
  // #region agent log
  debugLog("H4", "babel_config_returning_plugins", {
    presets: ["babel-preset-expo(with jsxImportSource nativewind)", "nativewind/babel"],
    plugins: ["expo-router/babel"],
  });
  // #region agent log
  console.error(
    "[DBG72e22a][H4] babel_config_returning_plugins",
    JSON.stringify({
      presets: ["babel-preset-expo(with jsxImportSource nativewind)", "nativewind/babel"],
      plugins: ["expo-router/babel"],
    })
  );
  // #endregion
  // #endregion
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: ["expo-router/babel"],
  };
};
