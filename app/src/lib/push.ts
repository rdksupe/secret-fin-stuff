import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { api } from './api';

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

/** Re-register on launch (silently, if already allowed) and open the right screen from taps. */
export function usePushRegistration() {
  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    registerPush(false);

    const open = (r: Notifications.NotificationResponse) => {
      const data = r.notification.request.content.data ?? {};
      if (data.kind === 'company' && typeof data.symbol === 'string') router.push({ pathname: '/company/[symbol]', params: { symbol: data.symbol } }); // research finished
      else if (data.kind === 'chat') router.push({ pathname: '/ask', params: typeof data.chat_id === 'string' ? { chat: data.chat_id } : {} }); // scheduled job / reminder from FINN
      else if (typeof data.feed_id === 'string') router.push({ pathname: '/story/[id]', params: { id: data.feed_id } });
    };
    Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
