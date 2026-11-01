import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// The app's session: a JWT the server mints when the investor unlocks FINN with the password.
// Kept in the phone's secure storage (Android Keystore-backed), never baked into the build.

const KEY = 'finn.session';
let token: string | null = null;
let loaded = false;
const listeners = new Set<(t: string | null) => void>();

export function getToken(): string | null {
  return token;
}

export async function loadToken(): Promise<string | null> {
  if (loaded) return token;
  try {
    token = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
  } catch {
    token = null;
  }
  loaded = true;
  return token;
}

export async function setToken(t: string | null): Promise<void> {
  token = t;
  loaded = true;
  try {
    if (Platform.OS === 'web') {
      if (t) globalThis.localStorage?.setItem(KEY, t);
      else globalThis.localStorage?.removeItem(KEY);
    } else if (t) await SecureStore.setItemAsync(KEY, t);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
  listeners.forEach((l) => l(t));
}

/** Called with the new token on unlock, and with null when the server rejects the session. */
export function onSessionChange(l: (t: string | null) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
