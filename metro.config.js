const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = Array.from(new Set([
  ...config.resolver.assetExts,
  'wasm',
]));

// Firebase JS SDK가 react-native 전용 빌드를 사용하도록 resolver 조건 추가
config.resolver.unstable_conditionNames = [
  'react-native',
  'require',
  'default',
];

module.exports = config;
