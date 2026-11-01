import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'finn.onboarded.v1';

export async function isOnboarded(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) === '1';
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    return true; // never trap someone in the intro because storage failed
  }
}

export async function setOnboarded(done = true): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, done ? '1' : '0');
    else await SecureStore.setItemAsync(KEY, done ? '1' : '0');
  } catch {}
}
