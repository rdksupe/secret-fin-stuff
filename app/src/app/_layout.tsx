import { JosefinSans_600SemiBold, JosefinSans_700Bold } from '@expo-google-fonts/josefin-sans';
import { PublicSans_400Regular, PublicSans_500Medium, PublicSans_600SemiBold, PublicSans_700Bold } from '@expo-google-fonts/public-sans';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { SourceSheet } from '@/components/source';
import { isOnboarded } from '@/lib/onboarding';
import { usePushRegistration } from '@/lib/push';
import { loadToken, onSessionChange } from '@/lib/session';
import { color } from '@/theme';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: color.bg, card: color.sea, text: color.text, border: color.line, primary: color.sea },
};

export default function RootLayout() {
  const [loaded] = useFonts({
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    JosefinSans_600SemiBold,
    JosefinSans_700Bold,
  });

  // The session (a server-minted token from the password) loads with the fonts, behind the splash.
  const [session, setSession] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    loadToken().then((t) => setSession(t ? 'in' : 'out'));
    // The server rejected the session (expired, or the password changed): back to unlock.
    return onSessionChange((t) => {
      if (!t) router.replace('/unlock' as never);
    });
  }, []);

  useEffect(() => {
    if (!loaded || session === 'loading') return;
    SplashScreen.hideAsync();
    if (session === 'out') {
      router.replace('/unlock' as never);
      return;
    }
    // First launch after unlocking: the intro (features + notification permission).
    isOnboarded().then((done) => {
      if (!done) router.push('/welcome' as never);
    });
  }, [loaded, session]);
  usePushRegistration();

  if (!loaded || session === 'loading') return null;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="story/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="company/[symbol]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="brain/[symbol]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="unlock" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <SourceSheet />
    </ThemeProvider>
  );
}
