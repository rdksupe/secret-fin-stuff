import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Ask for permission, register this device's FCM token with FINN, open stories from taps. */
export function usePushRegistration() {
  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('alerts', {
            name: 'Alerts',
            importance: Notifications.AndroidImportance.HIGH,
            lightColor: '#F0A63A',
          });
        }
        const perm = await Notifications.getPermissionsAsync();
        const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
        if (!granted || cancelled) return;
        const { data } = await Notifications.getDevicePushTokenAsync(); // native FCM token on Android
        await api.post('/push-token', { token: String(data), kind: 'fcm' });
      } catch (e) {
        console.warn('push registration failed', e);
      }
    })();

    const open = (r: Notifications.NotificationResponse) => {
      const feedId = r.notification.request.content.data?.feed_id;
      if (typeof feedId === 'string') router.push({ pathname: '/story/[id]', params: { id: feedId } });
    };
    Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}
