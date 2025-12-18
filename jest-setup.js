import "@testing-library/jest-native/extend-expect";

// Fix for jest-expo preset issues
jest.mock("expo/src/async-require/messageSocket", () => ({}), { virtual: true });

// Mock AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// Mock expo-file-system
jest.mock("expo-file-system", () => ({
  documentDirectory: "file://mock-directory/",
  makeDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  EncodingType: {
    Base64: "base64",
  },
}));

// Mock expo-constants
jest.mock("expo-constants", () => ({
  expoConfig: {
    extra: {
      eas: {
        projectId: "test-project-id",
      },
    },
  },
}));
