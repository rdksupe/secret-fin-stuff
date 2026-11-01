import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AskIcon } from '@/components/icons';
import { BarAction } from '@/components/top-bar';
import { Strong } from '@/components/type';
import { color, maxWidth, space } from '@/theme';

type Ctx = { symbol: string; page?: string; feed?: string };

const ask = ({ symbol, page, feed }: Ctx) =>
  router.push({ pathname: '/ask', params: { symbol, ...(page ? { page } : {}), ...(feed ? { feed } : {}) } });

/** "Ask FINN" as an app-bar action: always reachable, never over the content. */
export function AskAction(ctx: Ctx) {
  return (
    <BarAction label={`Ask FINN about ${ctx.symbol}`} onPress={() => ask(ctx)}>
      <AskIcon c={color.onSea} />
    </BarAction>
  );
}

/** The same action as a button at the end of the content, where the reader arrives having read it. */
export function AskButton({ label, ...ctx }: Ctx & { label?: string }) {
  return (
    <View style={{ alignItems: 'center', marginTop: space.xxl }}>
      <Pressable
        onPress={() => ask(ctx)}
        accessibilityRole="button"
        style={({ pressed }) => ({ width: '100%', maxWidth, height: 56, flexDirection: 'row', gap: 10, backgroundColor: pressed ? '#25605A' : color.sea, borderRadius: 28, justifyContent: 'center', alignItems: 'center' })}>
        <AskIcon c={color.onSea} />
        <Strong c={color.onSea}>{label ?? `Ask FINN about ${ctx.symbol}`}</Strong>
      </Pressable>
    </View>
  );
}
