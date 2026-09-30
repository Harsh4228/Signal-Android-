const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * The shared encryption/messaging code lives in ../../packages/core (TypeScript source),
 * and its @noble/* crypto dependencies are installed in the monorepo root node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const root = path.resolve(__dirname, '..', '..');
const core = path.join(root, 'packages', 'core');

const config = {
  watchFolders: [core, path.join(root, 'node_modules', '@noble')],
  resolver: {
    extraNodeModules: {
      '@meetme/core': path.join(core, 'src'),
    },
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')],
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
