import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Setback, SetbackPlate } from '@/components/deco';
import { ChevronDown, ChevronRight } from '@/components/icons';
import { Rule } from '@/components/story-row';
import { Body, Figure, Strong, Ticker } from '@/components/type';
import type { Brain, BrainFolder } from '@/lib/api';
import { color, deco, font, size, space } from '@/theme';

const tidy = (t: string, symbol: string) => {
  const s = t.replace(new RegExp(`^${symbol}\\s*[·—-]\\s*`), '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const openBrainPage = (symbol: string, path: string, section?: string) =>
  router.push({ pathname: '/brain/[symbol]', params: section ? { symbol, path, section } : { symbol, path } } as never);

function Folder({ symbol, f, startOpen }: { symbol: string; f: BrainFolder; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const empty = f.pages.length === 0;
  return (
    <View>
      <Pressable
        onPress={() => !empty && setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 20, alignItems: 'center' }}>
            {empty ? <View style={{ width: 4, height: 4, backgroundColor: color.faint }} /> : open ? <ChevronDown c={color.sea} size={18} /> : <ChevronRight c={color.sea} size={18} />}
          </View>
          <Figure size={14} c={empty ? color.text3 : color.text} style={{ fontFamily: font.semibold, flex: 1 }}>
            {f.name}/
          </Figure>
          <Figure size={12} c={color.text3}>{empty ? 'empty' : f.pages.length}</Figure>
        </View>
        {f.about ? (
          <Body size={size.meta} c={color.text3} style={{ marginLeft: 22, marginTop: 2 }}>{f.about}</Body>
        ) : null}
      </Pressable>
      {open &&
        f.pages.map((p) => (
          <View key={p.path} style={{ marginLeft: 22, borderLeftWidth: 1, borderLeftColor: color.line, paddingLeft: 12 }}>
            <Pressable onPress={() => openBrainPage(symbol, p.path)} style={({ pressed }) => ({ paddingVertical: 9, opacity: pressed ? 0.6 : 1 })}>
              <Body size={size.small} numberOfLines={2}>{tidy(p.title, symbol)}</Body>
              <Figure size={11} c={color.text3} style={{ marginTop: 1 }}>{p.path.split('/').pop()}</Figure>
            </Pressable>
            {p.tree ? (
              <Pressable onPress={() => openBrainPage(symbol, p.tree!)} hitSlop={6} style={{ paddingBottom: 9 }}>
                <Figure size={12} c={color.sea} style={{ fontFamily: font.semibold }}>PageIndex tree</Figure>
              </Pressable>
            ) : null}
          </View>
        ))}
      <Rule />
    </View>
  );
}

export const brainHome = (symbol: string) => router.push({ pathname: '/brain/[symbol]', params: { symbol } } as never);

/** Folders → pages. Lives on the brain screen; the company page only links to it. */
export function BrainTree({ brain }: { brain: Brain }) {
  const tree = brain.tree ?? [];
  const top = tree.find((f) => f.name === '')?.pages ?? [];
  const folders = tree.filter((f) => f.name !== '');
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {top.map((p) => (
          <Pressable
            key={p.path}
            onPress={() => openBrainPage(brain.symbol, p.path)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: p.path === 'index.md' ? color.sea : color.line,
              backgroundColor: p.path === 'index.md' ? color.seaTint : color.raised,
              paddingHorizontal: 12,
              paddingVertical: 8,
              minHeight: 40,
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}>
            <Figure size={13} c={p.path === 'index.md' ? color.sea : color.text} style={{ fontFamily: font.semibold }}>{p.path.replace(/\.md$/, '')}</Figure>
          </Pressable>
        ))}
      </View>
      <View style={{ marginTop: space.m }}>
        <Rule />
        {folders.map((f) => (
          <Folder key={f.name} symbol={brain.symbol} f={f} startOpen={f.name === 'dossier'} />
        ))}
      </View>
      <Strong size={size.meta} c={color.text3} style={{ marginTop: space.s }}>
        {`kb/companies/${brain.symbol}/wiki/`}
      </Strong>
    </View>
  );
}

/** One line on the company page: what's in the brain, and the way in. */
export function BrainEntry({ brain }: { brain: Brain }) {
  const folders = (brain.tree ?? []).filter((f) => f.name !== '' && f.pages.length > 0);
  const total = (brain.tree ?? []).reduce((n, f) => n + f.pages.length, 0);
  return (
    <Pressable
      onPress={() => brainHome(brain.symbol)}
      accessibilityRole="button"
      accessibilityLabel={`Open the ${brain.symbol} brain`}
      style={({ pressed }) => ({ marginTop: space.xl, opacity: pressed ? 0.88 : 1 })}>
      <SetbackPlate>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ticker size={deco.lead} c={color.brassOnSea}>{brain.symbol}</Ticker>
          <Body size={size.small} c={color.onSea} style={{ flex: 1, fontFamily: font.semibold }}>brain</Body>
          <Setback steps={3} onSea />
        </View>
        <Body size={size.small} c={color.onSea2} style={{ marginTop: space.s }}>
          Search and read everything FINN knows: {folders.map((f) => f.name).join(', ')}.
        </Body>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: 'rgba(238,244,241,0.18)' }}>
          <Figure size={13} c={color.onSea2} style={{ flex: 1, fontFamily: font.semibold }}>{total} pages</Figure>
          <ChevronRight c={color.onSea2} size={18} />
        </View>
      </SetbackPlate>
    </Pressable>
  );
}
