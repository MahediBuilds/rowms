// Metro configuration. The extra wasm asset type lets the SQLite store run in a
// web browser preview; it has no effect on the Android build.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("wasm");

module.exports = config;
