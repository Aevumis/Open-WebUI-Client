import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Safe JSON parse from AsyncStorage
 */
export async function getStorageJSON<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Safe JSON write to AsyncStorage
 */
export async function setStorageJSON<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/**
 * Remove item from AsyncStorage
 */
export async function removeStorageItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
