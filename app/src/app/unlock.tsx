import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native';

import { Setback, SetbackPlate } from '@/components/deco';
import { TopBar } from '@/components/top-bar';
import { Body, Strong, Title } from '@/components/type';
import { ApiError, unlock } from '@/lib/api';
import { isOnboarded } from '@/lib/onboarding';
import { registerPush } from '@/lib/push';
import { color, font, maxWidth, size, space, touch } from '@/theme';

/** The password screen: exchanges the password for a session the server mints. */
export default function Unlock() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password.trim());
      registerPush(false); // now that we can talk to the server
      router.replace((await isOnboarded()) ? '/' : ('/welcome' as never));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setError(
        status === 401
          ? "That password isn't right. Check it with the person who gave you FINN."
          : status === 429
            ? 'Too many tries. Wait a few minutes, then try again.'
            : ((e as Error)?.message ?? "Can't reach FINN's server. Check your connection."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }} behavior="padding">
      <TopBar title="FINN" />
      <View style={{ flex: 1, paddingHorizontal: space.l, paddingTop: space.xxl, width: '100%', maxWidth, alignSelf: 'center' }}>
        <SetbackPlate>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Title size={24} c={color.onSea} style={{ fontFamily: font.bold, flex: 1 }}>Unlock FINN</Title>
            <Setback steps={3} onSea />
          </View>
          <Body size={size.small} c={color.onSea2} style={{ marginTop: space.s }}>
            Enter the password you were given. FINN remembers this phone for 30 days.
          </Body>
        </SetbackPlate>

        <TextInput
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setError(null);
          }}
          onSubmitEditing={submit}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          placeholder="Password"
          placeholderTextColor={color.text3}
          accessibilityLabel="Password"
          style={{ marginTop: space.xl, height: 52, borderWidth: 1, borderColor: error ? color.loss : color.line, backgroundColor: color.raised, paddingHorizontal: 16, color: color.text, fontFamily: font.medium, fontSize: 16 } as never}
        />
        {error ? (
          <Body size={size.small} c={color.loss} style={{ marginTop: space.s }} accessibilityLiveRegion="polite">
            {error}
          </Body>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy || !password.trim()}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: space.l,
            height: 56,
            minHeight: touch,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: !password.trim() ? color.inset : pressed || busy ? '#25605A' : color.sea,
          })}>
          {busy ? <ActivityIndicator color={color.onSea} /> : <Strong c={password.trim() ? color.onSea : color.text3}>Unlock</Strong>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
