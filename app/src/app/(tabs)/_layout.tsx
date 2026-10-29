import { usePathname } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, maxWidth } from '@/theme';

// React 19: `ref` arrives as a normal prop, so TabTrigger asChild can hand it straight through.
function TabButton({ isFocused: _ignored, label, path, ...props }: TabTriggerSlotProps & { label: string; path: string }) {
  const pathname = usePathname();
  const isFocused = path === '/' ? pathname === '/' : pathname.startsWith(path);
  return (
    <Pressable {...(props as object)} accessibilityState={{ selected: isFocused }} style={{ paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center' }}>
      <Text style={{ fontFamily: font.medium, fontSize: 14, color: isFocused ? color.paper : color.dim, letterSpacing: 0.2 }}>
        {label}
      </Text>
      <View style={{ marginTop: 6, height: 2, width: 16, borderRadius: 1, backgroundColor: isFocused ? color.paper : 'transparent' }} />
    </Pressable>
  );
}

// TabList finds its triggers among its direct children, so the bar is passed in asChild.
function Bar({ children, ...props }: { children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignSelf: 'center',
        width: '100%',
        maxWidth,
        paddingBottom: Math.max(insets.bottom, 6),
      }}>
      {children}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <View style={{ backgroundColor: color.ink, borderTopWidth: 1, borderTopColor: color.hairline }}>
        <TabList asChild>
          <Bar>
            <TabTrigger name="index" href="/" asChild>
              <TabButton label="Brief" path="/" />
            </TabTrigger>
            <TabTrigger name="watch" href="/watch" asChild>
              <TabButton label="Watch" path="/watch" />
            </TabTrigger>
            <TabTrigger name="ask" href="/ask" asChild>
              <TabButton label="Ask" path="/ask" />
            </TabTrigger>
          </Bar>
        </TabList>
      </View>
    </Tabs>
  );
}
