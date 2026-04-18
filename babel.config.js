module.exports = function (api) {
  const isTest = process.env.NODE_ENV === 'test';
  api.cache.using(() => isTest);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 插件依赖 worklets；Jest 下已 mock reanimated，跳过以避免缺少 react-native-worklets
    plugins: isTest ? [] : ['react-native-reanimated/plugin'],
  };
};
