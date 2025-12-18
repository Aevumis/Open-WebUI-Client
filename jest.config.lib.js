module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["**/lib/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(expo-file-system|expo-constants|@react-native-async-storage|expo-modules-core|expo-asset|expo-font|expo-keep-awake|expo-router|react-native-edge-to-edge|react-native)/)",
  ],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
  },
  globals: {
    __DEV__: true,
  },
};
