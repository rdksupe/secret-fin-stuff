import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { MinusIcon, PlusIcon } from "@/components/icons";
import { Screen } from "@/components/screen";
import { TopBar } from "@/components/top-bar";
import { Spark } from "@/components/spark";
import { Rule } from "@/components/story-row";
import { Body, Figure, Pct, Ticker, Title } from "@/components/type";
import { api, type Holding, type Me } from "@/lib/api";
import { day as fmtDay, rupee } from "@/lib/format";
import { color, font, size, space, touch } from "@/theme";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "results", label: "Results" },
  { key: "management", label: "Management changes" },
  { key: "mna", label: "M&A and restructuring" },
  { key: "distress", label: "Defaults and insolvency" },
  { key: "rating", label: "Credit ratings" },
  { key: "orders", label: "Orders and contracts" },
  { key: "legal", label: "Legal and regulatory" },
  { key: "capital", label: "Dividends, buybacks, fund raises" },
];

function Stepper({
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) =>
    onChange(Math.round(Math.min(max, Math.max(min, v)) * 10) / 10);
  const btn = (plus: boolean, v: number, a11y: string) => (
    <Pressable
      onPress={() => set(v)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        width: touch,
        height: touch,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: pressed ? color.inset : color.raised,
      })}
    >
      {plus ? (
        <PlusIcon c={color.sea} size={20} />
      ) : (
        <MinusIcon c={color.sea} size={20} />
      )}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {btn(false, value - step, "Decrease")}
      <Figure
        size={16}
        style={{ minWidth: 60, textAlign: "center", fontFamily: font.semibold }}
      >
        {value}
        {unit}
      </Figure>
      {btn(true, value + step, "Increase")}
    </View>
  );
}

/** Material 3 switch: 52 x 32 track, sea when on. */
function Toggle({
  on,
  label,
  onPress,
}: {
  on: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={{ flexDirection: "row", alignItems: "center", minHeight: 56 }}
    >
      <Body size={15} c={color.text} style={{ flex: 1 }}>
        {label}
      </Body>
      <View
        style={{
          width: 52,
          height: 32,
          borderRadius: 16,
          backgroundColor: on ? color.sea : color.inset,
          borderWidth: 2,
          borderColor: on ? color.sea : color.text3,
          paddingHorizontal: on ? 2 : 6,
          alignItems: on ? "flex-end" : "flex-start",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: on ? 24 : 16,
            height: on ? 24 : 16,
            borderRadius: 12,
            backgroundColor: on ? color.onSea : color.text3,
          }}
        />
      </View>
    </Pressable>
  );
}

export default function Watch() {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [prices, setPrices] = useState<Record<string, number[]>>({});
  const [me, setMe] = useState<Me | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, m] = await Promise.all([
        api.get<Holding[]>("/holdings"),
        api.get<Me>("/me"),
      ]);
      setHoldings(h);
      setMe(m);
      api
        .get<Record<string, number[]>>("/holdings/prices?days=30")
        .then(setPrices)
        .catch(() => {});
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      setMe(await api.put<Me>("/me", patch));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const add = async () => {
    const syms = adding
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!syms.length) return;
    setBusy(`Building brains for ${syms.join(", ")}…`);
    try {
      await api.post("/holdings", { symbols: syms });
      setAdding("");
      await load();
    } catch (e: any) {
      setError(`Couldn't add ${syms.join(", ")}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const up = holdings?.filter((h) => (h.change_pct ?? 0) > 0).length ?? 0;
  const down = holdings?.filter((h) => (h.change_pct ?? 0) < 0).length ?? 0;
  const day = holdings?.find((h) => h.day)?.day;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar
        title="Watch"
        below={
          <Body c={color.onSea2} size={size.small}>
            {holdings
              ? `${holdings.length} companies · ${up} closed up, ${down} down${day ? ` on ${fmtDay(day)}` : ""}`
              : "Loading your companies…"}
          </Body>
        }
      />
      <Screen>
        {error && (
          <Body c={color.loss} size={13} style={{ marginBottom: space.m }}>
            {error}
          </Body>
        )}

        <View>
          <View style={{ flexDirection: "row", paddingBottom: space.s }}>
            <Body size={size.meta} c={color.text3} style={{ flex: 1 }}>
              Company
            </Body>
            <Body
              size={size.meta}
              c={color.text3}
              style={{ width: 44, textAlign: "right" }}
            >
              Weight
            </Body>
            <Body
              size={size.meta}
              c={color.text3}
              style={{ width: 96, textAlign: "right" }}
            >
              Last close
            </Body>
          </View>
          <Rule />
          {holdings === null ? (
            <ActivityIndicator
              color={color.sea}
              style={{ marginTop: space.xl }}
            />
          ) : (
            holdings.map((h) => (
              <View key={h.symbol}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/company/[symbol]",
                      params: { symbol: h.symbol },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${h.symbol}, open company`}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 60,
                    paddingVertical: 10,
                    gap: 10,
                    backgroundColor: pressed ? color.inset : "transparent",
                    marginHorizontal: -space.l,
                    paddingHorizontal: space.l,
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Ticker>{h.symbol}</Ticker>
                    <Body size={size.meta} c={color.text3} numberOfLines={1}>
                      {h.name ?? h.industry ?? ""}
                    </Body>
                  </View>
                  <Spark values={prices[h.symbol] ?? []} width={56} />
                  <Figure
                    size={13}
                    c={color.text2}
                    style={{ width: 44, textAlign: "right" }}
                  >
                    {h.weight ? `${h.weight}%` : "—"}
                  </Figure>
                  <View style={{ width: 96, alignItems: "flex-end" }}>
                    <Figure size={14} style={{ fontFamily: font.semibold }}>
                      {rupee(h.close)}
                    </Figure>
                    <Pct v={h.change_pct} size={12} digits={2} />
                  </View>
                </Pressable>
                <Rule />
              </View>
            ))
          )}
          <View style={{ flexDirection: "row", gap: 8, marginTop: space.l }}>
            <TextInput
              value={adding}
              onChangeText={setAdding}
              onSubmitEditing={add}
              autoCapitalize="characters"
              placeholder="Add NSE symbols, e.g. TRENT, KAYNES"
              placeholderTextColor={color.text3}
              style={
                {
                  flex: 1,
                  height: touch,
                  backgroundColor: color.raised,
                  borderWidth: 1,
                  borderColor: color.line,
                  paddingHorizontal: 14,
                  color: color.text,
                  fontFamily: font.medium,
                  fontSize: 15,
                  outlineStyle: "none",
                } as any
              }
            />
            <Pressable
              onPress={add}
              disabled={!!busy || !adding.trim()}
              accessibilityRole="button"
              style={{
                height: touch,
                paddingHorizontal: 20,
                justifyContent: "center",
                borderRadius: touch / 2,
                backgroundColor: adding.trim() ? color.sea : color.inset,
              }}
            >
              <Body
                size={size.small}
                c={adding.trim() ? color.onSea : color.text3}
                style={{ fontFamily: font.semibold }}
              >
                Add
              </Body>
            </Pressable>
          </View>
          {busy && (
            <Body
              size={size.small}
              c={color.brassText}
              style={{ marginTop: space.s }}
            >
              {busy}
            </Body>
          )}
        </View>

        {me && (
          <>
            <View style={{ marginTop: space.xxl }}>
              <Title size={size.lead}>Tell me when</Title>
              <Body c={color.text2} size={14} style={{ marginTop: space.s }}>
                FINN checks every close against these and pings you only when
                one is crossed.
              </Body>
            </View>
            <View style={{ marginTop: space.l, gap: space.l }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Body style={{ flex: 1 }}>Volume is at least</Body>
                <Stepper
                  value={me.thresholds.volume_x}
                  unit="×"
                  step={0.5}
                  min={1}
                  max={10}
                  onChange={(v) => save({ volume_x: v })}
                />
              </View>
              <Body c={color.text3} size={12} style={{ marginTop: -10 }}>
                its 20-day average
              </Body>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Body style={{ flex: 1 }}>Price moves more than</Body>
                <Stepper
                  value={me.thresholds.price_pct}
                  unit="%"
                  step={0.5}
                  min={0.5}
                  max={20}
                  onChange={(v) => save({ price_pct: v })}
                />
              </View>
              <Body c={color.text3} size={12} style={{ marginTop: -10 }}>
                in a single day, either way
              </Body>
            </View>

            <View style={{ marginTop: space.xxl }}>
              <Title size={size.lead}>Filings that ping me</Title>
              <Body c={color.text2} size={14} style={{ marginTop: space.s }}>
                Everything else still shows in the brief. FINN also pings on
                anything it judges serious, whatever the category.
              </Body>
            </View>
            <View style={{ marginTop: space.s }}>
              {CATEGORIES.map((c) => {
                const on = me.alert_categories.includes(c.key);
                return (
                  <Toggle
                    key={c.key}
                    on={on}
                    label={c.label}
                    onPress={() =>
                      save({
                        alert_categories: on
                          ? me.alert_categories.filter((k) => k !== c.key)
                          : [...me.alert_categories, c.key],
                      })
                    }
                  />
                );
              })}
            </View>
          </>
        )}
      </Screen>
    </View>
  );
}
