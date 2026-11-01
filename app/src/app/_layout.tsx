import { JosefinSans_600SemiBold, JosefinSans_700Bold } from '@expo-google-fonts/josefin-sans';
import { PublicSans_400Regular, PublicSans_500Medium, PublicSans_600SemiBold, PublicSans_700Bold } from '@expo-google-fonts/public-sans';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { isOnboarded } from '@/lib/onboarding';
import { usePushRegistration } from '@/lib/push';
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

  useEffect(() => {
    if (!loaded) return;
    SplashScreen.hideAsync();
    // First launch: the intro (features + notification permission) before anything else.
    isOnboarded().then((done) => {
      if (!done) router.push('/welcome' as never);
    });
  }, [loaded]);
  usePushRegistration();

  if (!loaded) return null;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="story/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="company/[symbol]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="brain/[symbol]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
    </ThemeProvider>
  );
}
