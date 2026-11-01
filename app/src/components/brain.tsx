import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Rule } from '@/components/story-row';
import { Body, Mono, Strong } from '@/components/type';
import type { Brain, BrainFolder } from '@/lib/api';
import { color, font, size, space } from '@/theme';

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
          <Mono size={13} c={empty ? color.faint : color.mist} style={{ width: 12 }}>{empty ? '·' : open ? '▾' : '▸'}</Mono>
          <Mono size={14} c={empty ? color.dim : color.paper} style={{ fontFamily: font.monoMedium, flex: 1 }}>
            {f.name}/
          </Mono>
          <Mono size={12} c={color.dim}>{empty ? 'empty' : f.pages.length}</Mono>
        </View>
        {f.about ? (
          <Body size={size.meta} c={color.dim} style={{ marginLeft: 22, marginTop: 2 }}>{f.about}</Body>
        ) : null}
      </Pressable>
      {open &&
        f.pages.map((p) => (
          <View key={p.path} style={{ marginLeft: 22, borderLeftWidth: 1, borderLeftColor: color.hairline, paddingLeft: 12 }}>
            <Pressable onPress={() => openBrainPage(symbol, p.path)} style={({ pressed }) => ({ paddingVertical: 9, opacity: pressed ? 0.6 : 1 })}>
              <Body size={size.small} numberOfLines={2}>{tidy(p.title, symbol)}</Body>
              <Mono size={11} c={color.dim} style={{ marginTop: 1 }}>{p.path.split('/').pop()}</Mono>
            </Pressable>
            {p.tree ? (
              <Pressable onPress={() => openBrainPage(symbol, p.tree!)} hitSlop={6} style={{ paddingBottom: 9 }}>
                <Mono size={11} c={color.marigold}>PageIndex tree ›</Mono>
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
              borderColor: p.path === 'index.md' ? color.marigold : color.hairline,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              opacity: pressed ? 0.7 : 1,
            })}>
            <Mono size={12} c={p.path === 'index.md' ? color.marigold : color.paper}>{p.path.replace(/\.md$/, '')}</Mono>
          </Pressable>
        ))}
      </View>
      <View style={{ marginTop: space.m }}>
        <Rule />
        {folders.map((f) => (
          <Folder key={f.name} symbol={brain.symbol} f={f} startOpen={f.name === 'dossier'} />
        ))}
      </View>
      <Strong size={size.meta} c={color.dim} style={{ marginTop: space.s }}>
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
      style={({ pressed }) => ({
        marginTop: space.xl,
        borderWidth: 1,
        borderColor: color.hairline,
        borderRadius: 14,
        padding: space.l,
        backgroundColor: pressed ? color.panel : color.well,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Strong style={{ flex: 1 }}>{brain.symbol} brain</Strong>
        <Mono size={12} c={color.mist}>{total} pages ›</Mono>
      </View>
      <Body size={size.small} c={color.mist} style={{ marginTop: 4 }}>
        Search and read everything FINN knows: {folders.map((f) => f.name).join(', ')}.
      </Body>
    </Pressable>
  );
}
