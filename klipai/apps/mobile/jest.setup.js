jest.mock('expo-secure-store', () => {
  const store = {};
  return { getItemAsync: async (k) => store[k] ?? null, setItemAsync: async (k, v) => { store[k] = v; }, deleteItemAsync: async (k) => { delete store[k]; } };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
