import { Linking, ScrollView, Text, View } from 'react-native';

import { color, font } from '@/theme';

// Small markdown renderer for FINN's answers: headings, paragraphs, lists, tables,
// bold, inline code, links. Enough for analyst-style replies; nothing exotic.

type OnLink = ((path: string) => void) | undefined;

const toPath = (t: string) => (t.endsWith('.md') ? t : `${t}.md`);

function inline(text: string, base: object, key: string, onLink?: OnLink) {
  const parts: React.ReactNode[] = [];
  const re = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\([a-z0-9_-]+\/[^)\s]+\.md\))/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('[[')) {
      // Obsidian-style link inside the company brain: [[results/2026-09-30]] or [[profile|Business profile]]
      const [target, label] = t.slice(2, -2).split('|');
      parts.push(
        <Text
          key={`${key}w${i++}`}
          onPress={onLink ? () => onLink(toPath(target.trim())) : undefined}
          style={{ color: onLink ? color.sea : color.text2, fontFamily: onLink ? font.semibold : undefined, textDecorationLine: onLink ? 'underline' : 'none' }}>
          {(label ?? target).trim()}
        </Text>,
      );
    } else if (t.startsWith('**')) {
      parts.push(<Text key={`${key}b${i++}`} style={{ fontFamily: font.semibold }}>{t.slice(2, -2)}</Text>);
    } else if (t.startsWith('`')) {
      parts.push(<Text key={`${key}c${i++}`} style={{ fontFamily: font.medium, fontSize: 13, color: color.text2 }}>{t.slice(1, -1)}</Text>);
    } else if (t.startsWith('[')) {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/) ?? [];
      parts.push(
        <Text
          key={`${key}l${i++}`}
          onPress={() => (onLink && !/^[a-z]+:/i.test(href) && href.endsWith('.md') ? onLink(href.replace(/^\.\//, '')) : Linking.openURL(href))}
          style={{ textDecorationLine: 'underline' }}>
          {label}
        </Text>,
      );
    } else {
      // (results/2026-09-30.md) — a citation into the company brain
      parts.push(
        <Text
          key={`${key}s${i++}`}
          onPress={onLink ? () => onLink(t.slice(1, -1)) : undefined}
          style={{ fontFamily: font.medium, fontSize: 12, color: onLink ? color.sea : color.text3 }}>
          {t}
        </Text>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Text style={base}>{parts}</Text>;
}

function Table({ rows, k }: { rows: string[][]; k: string }) {
  const [head, ...body] = rows;
  const numeric = (s: string) => /^[−\-+]?[₹]?[\d,.]+%?$|^—$/.test(s.trim());
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
      <View>
        {[head, ...body].map((r, ri) => (
          <View
            key={`${k}r${ri}`}
            style={{
              flexDirection: 'row',
              borderBottomWidth: ri === 0 ? 1 : 0.5,
              borderColor: ri === 0 ? color.line : 'rgba(38,44,55,0.6)',
              paddingVertical: 6,
            }}>
            {r.map((c, ci) => (
              <Text
                key={`${k}r${ri}c${ci}`}
                style={{
                  minWidth: ci === 0 ? 96 : 76,
                  paddingRight: 12,
                  textAlign: ci > 0 && numeric(c) ? 'right' : 'left',
                  fontFamily: ri === 0 ? font.semibold : numeric(c) ? font.medium : font.regular,
                  fontSize: ri === 0 ? 12 : 14,
                  color: ri === 0 ? color.text2 : c.trim().startsWith('-') || c.trim().startsWith('−') ? color.loss : color.text,
                  fontVariant: ['tabular-nums'],
                }}>
                {c.replace(/\*\*/g, '')}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Markdown({ text, size = 15, onLink }: { text: string; size?: number; onLink?: OnLink }) {
  const base = { fontFamily: font.regular, fontSize: size, lineHeight: size * 1.5, color: color.text };
  const lines = text.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(<Table key={`t${k++}`} rows={rows} k={`t${k}`} />);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      out.push(
        <Text key={`h${k++}`} style={{ fontFamily: font.semibold, fontSize: h[1].length <= 2 ? size + 2 : size, color: color.text, marginTop: 10, marginBottom: 2 }}>
          {h[2].replace(/\*\*/g, '')}
        </Text>,
      );
      i++;
      continue;
    }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)/);
    if (li) {
      const bullet = /\d/.test(li[1]) ? li[1] : '·';
      out.push(
        <View key={`l${k++}`} style={{ flexDirection: 'row', paddingLeft: 2, marginVertical: 1 }}>
          <Text style={[base, { width: 18, color: color.text2, fontFamily: font.medium }]}>{bullet}</Text>
          <View style={{ flex: 1 }}>{inline(li[2], base, `l${k}`, onLink)}</View>
        </View>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s|\s*\|)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(
      <View key={`p${k++}`} style={{ marginVertical: 3 }}>
        {inline(para.join('\n'), base, `p${k}`, onLink)}
      </View>,
    );
  }
  return <View>{out}</View>;
}
