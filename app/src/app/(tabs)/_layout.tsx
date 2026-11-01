import { usePathname } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AskIcon, BriefIcon, WatchIcon } from '@/components/icons';
import { color, font } from '@/theme';

const ICONS = { Brief: BriefIcon, Watch: WatchIcon, Ask: AskIcon } as const;

// Material 3 navigation bar: icon in an indicator pill, label below, 64dp tall.
function TabButton({ isFocused: _ignored, label, path, ...props }: TabTriggerSlotProps & { label: keyof typeof ICONS; path: string }) {
  const pathname = usePathname();
  const isFocused = path === '/' ? pathname === '/' : pathname.startsWith(path);
  const Icon = ICONS[label];
  return (
    <Pressable
      {...(props as object)}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 12, paddingBottom: 14, minHeight: 64 }}>
      <View style={{ width: 64, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: isFocused ? color.seaTint : 'transparent' }}>
        <Icon c={isFocused ? color.sea : color.text2} />
      </View>
      <Text style={{ marginTop: 4, fontFamily: isFocused ? font.bold : font.medium, fontSize: 12, letterSpacing: 0.3, color: isFocused ? color.text : color.text2 }}>{label}</Text>
    </Pressable>
  );
}

// TabList finds its triggers among its direct children, so the bar is passed in asChild.
function Bar({ children, ...props }: { children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', width: '100%', paddingBottom: insets.bottom, backgroundColor: color.inset, borderTopWidth: 1, borderTopColor: color.line }}>
      {children}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      {/* TabList must be a direct child of Tabs, or its triggers are never registered on native. */}
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
    </Tabs>
  );
}
