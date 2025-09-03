import AsyncStorage from "@react-native-async-storage/async-storage";

export async function getString(key: string) {
  return AsyncStorage.getItem(key);
}
export async function setString(key: string, value: string) {
  await AsyncStorage.setItem(key, value);
}
export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export async function setJSON(key: string, value: any) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
