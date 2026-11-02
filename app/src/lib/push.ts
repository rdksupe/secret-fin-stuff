import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { api } from './api';
import { getToken, onSessionChange } from './session';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Register this device's FCM token with FINN. Asks for permission only when `ask` (onboarding). */
export async function registerPush(ask: boolean): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#F0A63A',
      });
    }
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (ask && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return false;
    const { data } = await Notifications.getDevicePushTokenAsync(); // native FCM token on Android
    await api.post('/push-token', { token: String(data), kind: 'fcm' });
    return true;
  } catch (e) {
    console.warn('push registration failed', e);
    return false;
  }
}

/** Ask for notification permission only. Used by the tour, which runs before there is a session. */
export async function askPushPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', { name: 'Alerts', importance: Notifications.AndroidImportance.HIGH, lightColor: '#F0A63A' });
    }
    const perm = await Notifications.getPermissionsAsync();
    return perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Re-register on launch (silently, if already allowed) and open the right screen from taps. */
export function usePushRegistration() {
  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    // Register (idempotently) whenever it can matter: launch, a new session, and every return to
    // the foreground. A reinstall or an FCM token rotation otherwise leaves the server with no device.
    const sync = () => getToken() && registerPush(false);
    sync();
    const offSession = onSessionChange((t) => t && registerPush(false));
    const appState = AppState.addEventListener('change', (s) => s === 'active' && sync());

    const open = (r: Notifications.NotificationResponse) => {
      const data = r.notification.request.content.data ?? {};
      if (data.kind === 'watch' && typeof data.job_id === 'string') router.push({ pathname: '/watches/[id]', params: { id: data.job_id } }); // a scheduled watch's result
      else if (data.kind === 'company' && typeof data.symbol === 'string') router.push({ pathname: '/company/[symbol]', params: { symbol: data.symbol } }); // research finished
      else if (data.kind === 'chat') router.push({ pathname: '/ask', params: typeof data.chat_id === 'string' ? { chat: data.chat_id } : {} }); // scheduled job / reminder from FINN
      else if (typeof data.feed_id === 'string') router.push({ pathname: '/story/[id]', params: { id: data.feed_id } });
    };
    Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      sub.remove();
      appState.remove();
      offSession();
    };
  }, []);
}

/** Whether this phone will get FINN's notifications, and a way to turn them on (for the Brief banner). */
export function usePushPermission() {
  const [state, setState] = useState<'granted' | 'off' | 'unknown'>('unknown');
  const check = useCallback(async () => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return setState('granted');
    try {
      setState((await Notifications.getPermissionsAsync()).granted ? 'granted' : 'off');
    } catch {
      setState('unknown');
    }
  }, []);
  useEffect(() => {
    check();
    const s = AppState.addEventListener('change', (a) => a === 'active' && check());
    return () => s.remove();
  }, [check]);
  const turnOn = useCallback(async () => {
    await registerPush(true);
    await check();
  }, [check]);
  return { state, turnOn };
}
