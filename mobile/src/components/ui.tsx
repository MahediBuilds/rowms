import { ReactNode, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardTypeOptions, Modal, Pressable, StyleProp, StyleSheet, Text, TextInput, TextStyle, View, ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, T } from "../theme";
import type { StageState } from "../store";
import { todayIso } from "../store";

export type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------- text

export function H({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h, style]}>{children}</Text>;
}
export function P({ children, muted, small, style }: { children: ReactNode; muted?: boolean; small?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.p, muted && { color: C.muted }, small && { fontSize: T.s }, style]}>{children}</Text>;
}

// ---------------------------------------------------------------- buttons

export function Button({
  title, onPress, kind = "primary", icon, disabled, busy, style, small,
}: {
  title: string; onPress: () => void; kind?: "primary" | "secondary" | "danger" | "ghost"; icon?: IconName; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const bg = kind === "primary" ? C.field : kind === "danger" ? C.surface : kind === "ghost" ? "transparent" : C.surface;
  const fg = kind === "primary" ? "#fff" : kind === "danger" ? C.red : C.ink;
  const border = kind === "primary" ? C.field : kind === "danger" ? "#E2B5B1" : kind === "ghost" ? "transparent" : C.lineStrong;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 17 : 20} color={fg} /> : null}
      <Text style={[s.btnText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- layout

export function Card({ children, style, title, right }: { children: ReactNode; style?: StyleProp<ViewStyle>; title?: string; right?: ReactNode }) {
  return (
    <View style={[s.card, style]}>
      {title && (
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>{title}</Text>
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Row({ title, sub, right, onPress, left, warn }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; onPress?: () => void; left?: ReactNode; warn?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && onPress && { backgroundColor: C.sunk }]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.rowTitle, warn && { color: C.red }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={s.rowSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color={C.faint} />}
    </Pressable>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ padding: 32, alignItems: "center" }}>
      <Text style={{ fontSize: T.l, fontWeight: "700", color: C.ink, textAlign: "center" }}>{title}</Text>
      {children ? <Text style={{ marginTop: 6, color: C.muted, textAlign: "center", fontSize: T.m }}>{children}</Text> : null}
    </View>
  );
}

type Tone = "green" | "yellow" | "red" | "blue" | "grey";
const TONES: Record<Tone, [string, string]> = {
  green: [C.fieldTint, C.fieldDark], yellow: [C.yellowTint, "#6d4d00"], red: [C.redTint, "#8f2a23"], blue: [C.blueTint, "#1f477f"], grey: [C.sunk, C.inkSoft],
};
export function Badge({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  const [bg, fg] = TONES[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{children}</Text>
    </View>
  );
}

export function NotSynced() {
  return <Badge tone="yellow">Not uploaded</Badge>;
}

export function ProgressStrip({ stages, big }: { stages: StageState[]; big?: boolean }) {
  const done = stages.filter((x) => x.completed).length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }} accessibilityLabel={`${done} of ${stages.length} stages done`}>
      {stages.map((st) => (
        <View
          key={st.code}
          style={[
            { width: big ? 22 : 11, height: big ? 16 : 11, borderRadius: 3, backgroundColor: C.stageOff, borderWidth: 1, borderColor: "#cfd6d0" },
            st.completed && { backgroundColor: C.field, borderColor: C.fieldDark },
            st.partial && { backgroundColor: C.yellowBright, borderColor: "#b9922c" },
          ]}
        />
      ))}
      <Text style={{ marginLeft: 5, color: C.muted, fontSize: 12 }}>
        {done}/{stages.length}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- form fields

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>
        {label}
        {required ? " *" : ""}
      </Text>
      {children}
      {error ? <Text style={s.error}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input({
  label, value, onChange, hint, error, required, keyboard, multiline, maxLength, placeholder, autoCapitalize, secure,
}: {
  label: string; value: string | number | null | undefined; onChange: (v: string) => void; hint?: string; error?: string; required?: boolean;
  keyboard?: KeyboardTypeOptions; multiline?: boolean; maxLength?: number; placeholder?: string; autoCapitalize?: "none" | "words" | "sentences" | "characters";
  secure?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <TextInput
        value={value === null || value === undefined ? "" : String(value)}
        onChangeText={onChange}
        keyboardType={keyboard}
        multiline={multiline}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={C.faint}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secure}
        autoCorrect={secure ? false : undefined}
        style={[s.input, multiline && { minHeight: 84, textAlignVertical: "top" }, error && { borderColor: C.red }]}
      />
    </Field>
  );
}

export function DateInput({ label, value, onChange, hint }: { label: string; value: string | null | undefined; onChange: (v: string) => void; hint?: string }) {
  const bad = !!value && !/^\d{4}-\d{2}-\d{2}$/.test(value);
  return (
    <Field label={label} hint={hint ?? "Year-month-day, e.g. 2026-10-08"} error={bad ? "Use the format YYYY-MM-DD" : undefined}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={value || ""} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={C.faint} keyboardType="numbers-and-punctuation" style={[s.input, { flex: 1 }]} />
        <Button title="Today" kind="secondary" small onPress={() => onChange(todayIso())} />
      </View>
    </Field>
  );
}

export type Opt = { value: string; label: string; sub?: string };

/** Full-screen option picker - large targets, searchable for long lists. */
export function Select({
  label, value, options, onChange, required, placeholder = "Choose…", hint, allowClear,
}: {
  label: string; value: string | null | undefined; options: Opt[]; onChange: (v: string | null) => void; required?: boolean; placeholder?: string; hint?: string; allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const insets = useSafeAreaInsets();
  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(t)) : options;
  }, [q, options]);
  return (
    <Field label={label} required={required} hint={hint}>
      <Pressable onPress={() => setOpen(true)} style={[s.input, { flexDirection: "row", alignItems: "center" }]} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={{ flex: 1, fontSize: T.m, color: current ? C.ink : C.faint }} numberOfLines={1}>
          {current ? current.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={C.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: C.paper, paddingTop: insets.top }}>
          <View style={s.modalHead}>
            <Text style={s.modalTitle}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </View>
          {options.length > 8 && (
            <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={C.faint} style={[s.input, { margin: 12 }]} autoFocus />
          )}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              allowClear && value ? (
                <Row
                  title="None"
                  onPress={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                />
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                  setQ("");
                }}
                style={({ pressed }) => [s.opt, pressed && { backgroundColor: C.sunk }, item.value === value && { backgroundColor: C.fieldTint }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: T.m, color: C.ink }}>{item.label}</Text>
                  {item.sub ? <Text style={{ color: C.muted, fontSize: T.s, marginTop: 2 }}>{item.sub}</Text> : null}
                </View>
                {item.value === value && <Ionicons name="checkmark" size={22} color={C.field} />}
              </Pressable>
            )}
            ListEmptyComponent={<Empty title="Nothing to choose from" />}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          />
        </View>
      </Modal>
    </Field>
  );
}

export function Toggle({ label, value, onChange, sub }: { label: string; value: boolean; onChange: (v: boolean) => void; sub?: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <View style={[s.tick, value && { backgroundColor: C.field, borderColor: C.field }]}>{value && <Ionicons name="checkmark" size={18} color="#fff" />}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: T.m, color: C.ink }}>{label}</Text>
        {sub ? <Text style={{ fontSize: T.s, color: C.muted }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Section({ title }: { title: string }) {
  return <Text style={s.section}>{title}</Text>;
}

export const s = StyleSheet.create({
  h: { fontSize: T.xl, fontWeight: "700", color: C.ink },
  p: { fontSize: T.m, color: C.ink, lineHeight: 22 },
  btn: { minHeight: 48, borderRadius: R.s, borderWidth: 1, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnSmall: { minHeight: 38, paddingHorizontal: 12 },
  btnText: { fontSize: T.m, fontWeight: "700" },
  card: { backgroundColor: C.surface, borderRadius: R.m, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  cardTitle: { flex: 1, fontSize: T.l, fontWeight: "700", color: C.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 16, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: "#E8ECE8", minHeight: 60 },
  rowTitle: { fontSize: T.m, fontWeight: "700", color: C.ink },
  rowSub: { fontSize: T.s, color: C.muted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: "flex-start" },
  label: { fontSize: 14, fontWeight: "700", color: C.inkSoft, marginBottom: 6 },
  hint: { fontSize: 12.5, color: C.muted, marginTop: 4 },
  error: { fontSize: 12.5, color: C.red, marginTop: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.s, backgroundColor: C.surface, paddingHorizontal: 12, fontSize: T.m, color: C.ink },
  modalHead: { flexDirection: "row", alignItems: "center", backgroundColor: C.ink, paddingHorizontal: 16, paddingVertical: 14 },
  modalTitle: { flex: 1, color: "#fff", fontSize: T.l, fontWeight: "700" },
  opt: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: "#E8ECE8", backgroundColor: C.surface, minHeight: 56 },
  tick: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center", backgroundColor: C.surface },
  section: { fontSize: T.m, fontWeight: "700", color: C.ink, marginTop: 8, marginBottom: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
});
