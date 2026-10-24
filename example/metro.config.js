const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The repo root's node_modules has its own react and react-native (npm installs peer dependencies), expo and
// expo-modules-core: bundle only the example's. A second react-native is incompatible, and a second expo or
// expo-modules-core breaks native module setup on Android.
config.resolver.blockList = [
  ...Array.from(config.resolver.blockList ?? []),
  // Windows paths have `\`, which the RegExp needs escaped.
  ...['react', 'react-native', 'expo', 'expo-modules-core'].map(
    (name) =>
      new RegExp(path.resolve('..', 'node_modules', name).replace(/\\/g, '\\\\') + '[/\\\\]')
  ),
];

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

config.resolver.extraNodeModules = {
  'react-native-minimal-webview': '..',
};

config.watchFolders = [path.resolve(__dirname, '..')];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
