import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useChoices } from "../choices";
import { GpsBadge, GpsCapture } from "../components/Gps";
import { Photos } from "../components/Photos";
import { SyncBar } from "../components/SyncBar";
import { Badge, Button, Card, Empty, Input, NotSynced, Row, s as ui, Section, Select, Toggle } from "../components/ui";
import type { RootStack, ScreenProps } from "../nav";
import { useLocal, useSession } from "../session";
import { deleteRecord, Gps, Land, landLabel, linkOwner, round2, round7, saveRecord, snapshot } from "../store";
import { C } from "../theme";

export function LandsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { projectId, gpsLimit } = useSession();
  const [snap] = useLocal(snapshot);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    if (!snap) return [];
    const t = q.trim().toLowerCase();
    return snap.lands
      .filter((l) => !projectId || !l.project_ids?.length || l.project_ids.includes(projectId))
      .map((l) => ({ l, owners: snap.ownersOf(l.id) }))
      .filter(({ l, owners }) => !t || `${l.survey_number} ${l.hissa} ${l.village} ${l.rtc_reference} ${owners.map((o) => o.name).join(" ")}`.toLowerCase().includes(t))
      .sort((a, b) => `${a.l.village}${a.l.survey_number.padStart(6, "0")}`.localeCompare(`${b.l.village}${b.l.survey_number.padStart(6, "0")}`));
  }, [snap, q, projectId]);
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search survey no., village, owner" placeholderTextColor={C.faint} style={ui.input} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.l.id}
        renderItem={({ item: { l, owners } }) => (
          <Row
            onPress={() => nav.navigate("Land", { id: l.id })}
            left={<GpsBadge accuracy={l.latitude === null || l.latitude === undefined ? undefined : l.gps_accuracy_m} limit={gpsLimit} />}
            title={landLabel(l)}
            sub={owners.length ? owners.map((o) => o.name).join(", ") : "No owner linked"}
            right={l._dirty ? <NotSynced /> : undefined}
          />
        )}
        ListEmptyComponent={<Empty title={q ? "No land records match" : "No land records yet"} />}
        contentContainerStyle={{ paddingBottom: 90 }}
      />
      <Pressable
        onPress={() => nav.navigate("Land", {})}
        style={{ position: "absolute", right: 18, bottom: 22, width: 60, height: 60, borderRadius: 30, backgroundColor: C.field, alignItems: "center", justifyContent: "center", elevation: 4 }}
        accessibilityLabel="New land record"
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
    </View>
  );
}

const EMPTY: Partial<Land> = {
  survey_number: "", hissa: "", village: "", hobli: "", taluk: "", district: "", state: "Karnataka", extent_acres: "", extent_guntas: "",
  ownership_type: "INDIVIDUAL", land_type: "DRY", rtc_reference: "", remarks: "",
};

export function LandScreen({ route, navigation }: ScreenProps<"Land">) {
  const { projectId, gpsLimit, can } = useSession();
  const { list, label } = useChoices();
  const [snap] = useLocal(snapshot);
  const id = route.params?.id;
  // open the saved record only once the local list contains it (avoids a "not found" flash)
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (createdId && snap?.lands?.some((x) => x.id === createdId)) {
      navigation.setParams({ id: createdId });
      setCreatedId(null);
    }
  }, [createdId, snap, navigation]);
  const land = id ? snap?.lands.find((l) => l.id === id) : undefined;
  const [form, setForm] = useState<Partial<Land>>(EMPTY);
  const [base, setBase] = useState<Land | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(!id);
  const [gps, setGps] = useState<Gps | null>(null);
  const [error, setError] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [primary, setPrimary] = useState(false);

  useEffect(() => {
    if (land && !editing) {
      setForm({ ...land, extent_acres: String(land.extent_acres ?? ""), extent_guntas: String(land.extent_guntas ?? "") });
      setBase(land);
    }
  }, [land, editing]);
  useLayoutEffect(() => {
    navigation.setOptions({ title: land ? landLabel(land).replace(/, .*/, "") : "New land record" });
  }, [land, navigation]);

  // when coming from a farmer, prefill their village
  useEffect(() => {
    const fid = route.params?.farmerId;
    if (!id && fid && snap) {
      const f = snap.farmerById.get(fid);
      if (f) setForm((x) => ({ ...x, village: x.village || f.village, hobli: x.hobli || f.hobli, taluk: x.taluk || f.taluk, district: x.district || f.district }));
    }
  }, [snap, id, route.params?.farmerId]);

  if (!snap) return null;
  if (id && !land) return <Empty title="Land record not found on this phone" />;

  const set = (k: keyof Land, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const owners = land ? snap.ownerships.filter((o) => o.land_id === land.id) : [];
  const assets = land ? snap.assets.filter((a) => a.land_parcel_id === land.id) : [];
  const farmerOpts = snap.farmers
    .filter((f) => !projectId || !f.project_ids?.length || f.project_ids.includes(projectId))
    .filter((f) => !owners.some((o) => o.farmer_id === f.id))
    .map((f) => ({ value: f.id, label: f.name, sub: `${f.farmer_code ?? "New"}${f.village ? `, ${f.village}` : ""}` }));

  const num = (v: any) => (v === "" || v === null || v === undefined ? 0 : Number(v));

  const save = async () => {
    if (saving) return;
    setError("");
    if (!form.survey_number?.trim()) return setError("Enter the survey number.");
    if (!form.village?.trim()) return setError("Enter the village.");
    const acres = num(form.extent_acres);
    const guntas = num(form.extent_guntas);
    if (Number.isNaN(acres) || Number.isNaN(guntas) || acres < 0 || guntas < 0) return setError("Extent must be a positive number.");
    setSaving(true);
    try {
      const rec: any = {
        ...form, id: land?.id, survey_number: form.survey_number.trim(), extent_acres: round2(acres), extent_guntas: round2(guntas),
      };
      delete rec._dirty;
      if (!land) rec.project_ids = projectId ? [projectId] : [];
      if (gps) Object.assign(rec, { latitude: round7(gps.latitude), longitude: round7(gps.longitude), gps_accuracy_m: gps.accuracy !== null ? round2(gps.accuracy) : null, gps_captured_at: gps.at || null });
      const saved = await saveRecord<any>("land", rec, land ? base : undefined);
      if (!land && route.params?.farmerId) await linkOwner(saved.id, route.params.farmerId, true);
      setEditing(false);
      if (!land) setCreatedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const saveGps = async (g: Gps) => {
    if (!land) return setGps(g);
    await saveRecord<any>("land", { id: land.id, latitude: round7(g.latitude), longitude: round7(g.longitude), gps_accuracy_m: g.accuracy !== null ? round2(g.accuracy) : null, gps_captured_at: g.at });
  };
  const landGps: Gps | null = land && land.latitude !== null && land.latitude !== undefined
    ? { latitude: Number(land.latitude), longitude: Number(land.longitude), accuracy: land.gps_accuracy_m === null ? null : Number(land.gps_accuracy_m), at: land.gps_captured_at || "" }
    : null;

  const addOwner = async () => {
    if (!land || !owner) return;
    await linkOwner(land.id, owner, primary || owners.length === 0);
    setOwner(null);
    setPrimary(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {land && !editing && (
          <Card title={landLabel(land)} right={can("land", "write") ? <Button title="Edit" small kind="secondary" icon="create-outline" onPress={() => setEditing(true)} /> : undefined}>
            <Text style={{ fontSize: 16, color: C.inkSoft }}>
              {num(land.extent_acres)} acres {num(land.extent_guntas)} guntas, {label("land_types", land.land_type).toLowerCase()}
            </Text>
            <Text style={{ color: C.muted, marginTop: 4 }}>{[land.hobli, land.taluk, land.district].filter(Boolean).join(", ")}</Text>
            {land.rtc_reference ? <Text style={{ color: C.muted, marginTop: 4 }}>RTC {land.rtc_reference}</Text> : null}
            {land._dirty && <View style={{ marginTop: 8 }}><NotSynced /></View>}
          </Card>
        )}

        {editing && (
          <Card title={land ? "Edit land record" : "New land record"}>
            <Input label="Survey number" value={form.survey_number} onChange={(v) => set("survey_number", v)} required keyboard="numbers-and-punctuation" />
            <Input label="Sub-division / hissa" value={form.hissa} onChange={(v) => set("hissa", v)} autoCapitalize="characters" />
            <Input label="Village" value={form.village} onChange={(v) => set("village", v)} required autoCapitalize="words" />
            <Input label="Hobli" value={form.hobli} onChange={(v) => set("hobli", v)} autoCapitalize="words" />
            <Input label="Taluk" value={form.taluk} onChange={(v) => set("taluk", v)} autoCapitalize="words" />
            <Input label="District" value={form.district} onChange={(v) => set("district", v)} autoCapitalize="words" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Input label="Extent (acres)" value={form.extent_acres as any} onChange={(v) => set("extent_acres", v)} keyboard="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Guntas" value={form.extent_guntas as any} onChange={(v) => set("extent_guntas", v)} keyboard="decimal-pad" />
              </View>
            </View>
            <Select label="Land type" value={form.land_type} options={list("land_types")} onChange={(v) => set("land_type", v || "DRY")} />
            <Select label="Ownership" value={form.ownership_type} options={list("ownership_types")} onChange={(v) => set("ownership_type", v || "INDIVIDUAL")} />
            <Input label="RTC / Pahani reference" value={form.rtc_reference} onChange={(v) => set("rtc_reference", v)} />
            {!land && <GpsCapture value={gps} onCapture={setGps} limit={gpsLimit} label="GPS (centre of the land)" />}
            <Input label="Remarks" value={form.remarks} onChange={(v) => set("remarks", v)} multiline />
            {!land && route.params?.farmerId && (
              <Text style={{ color: C.muted, marginBottom: 10 }}>{snap.farmerById.get(route.params.farmerId)?.name} will be linked as the primary owner.</Text>
            )}
            {error ? <Text style={{ color: C.red, marginBottom: 10 }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title={land ? "Save" : "Save land record"} icon="checkmark" onPress={save} busy={saving} style={{ flex: 1 }} />
              {land && <Button title="Cancel" kind="secondary" onPress={() => setEditing(false)} />}
            </View>
          </Card>
        )}

        {land && (
          <>
            <Card title="Owners">
              {owners.length === 0 && <Text style={{ color: C.muted, marginBottom: 8 }}>No owner linked yet.</Text>}
              {owners.map((o) => {
                const f = snap.farmerById.get(o.farmer_id);
                return (
                  <Row
                    key={o.id}
                    title={f?.name ?? "Farmer"}
                    sub={`${f?.farmer_code ?? "New farmer"}${o.is_primary_payee ? ", primary payee" : ""}`}
                    onPress={() => f && navigation.navigate("Farmer", { id: f.id })}
                    right={
                      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                        {!o.is_primary_payee && (
                          <Pressable onPress={() => linkOwner(land.id, o.farmer_id, true)} hitSlop={8}>
                            <Text style={{ color: C.blue, fontWeight: "700" }}>Make payee</Text>
                          </Pressable>
                        )}
                        {can("ownership", "delete") && (
                          <Pressable
                            onPress={() =>
                              Alert.alert("Remove owner?", `${f?.name} will be unlinked from this survey number.`, [
                                { text: "Cancel", style: "cancel" },
                                { text: "Remove", style: "destructive", onPress: () => deleteRecord("ownership", o.id) },
                              ])
                            }
                            hitSlop={8}
                            accessibilityLabel="Remove owner"
                          >
                            <Ionicons name="close-circle-outline" size={22} color={C.muted} />
                          </Pressable>
                        )}
                      </View>
                    }
                  />
                );
              })}
              <Section title="Add owner" />
              <Select label="Farmer" value={owner} options={farmerOpts} onChange={setOwner} allowClear hint="Register the farmer first if they are not listed." />
              {owner && (
                <>
                  <Toggle label="Primary payee" value={primary || owners.length === 0} onChange={setPrimary} sub="Compensation is paid to the primary payee." />
                  <Button title="Add owner" icon="person-add" onPress={addOwner} />
                </>
              )}
              <Button title="Register new farmer" kind="ghost" icon="add" onPress={() => navigation.navigate("Farmer", { landId: land.id })} style={{ marginTop: 6 }} />
            </Card>

            <Card title="GPS">
              <GpsCapture value={landGps} onCapture={saveGps} limit={gpsLimit} label="Centre of the land" />
            </Card>

            <Card title="RTC / land documents">
              <Photos links={{ land_parcel: land.id }} linkField="land_parcel" category="LAND_RTC" title={`RTC ${landLabel(land)}`} label="Photo of RTC / Pahani" />
            </Card>

            <Card title="Poles & towers on this land">
              {assets.length === 0 ? (
                <Text style={{ color: C.muted }}>None yet.</Text>
              ) : (
                assets.map((a) => <Row key={a.id} title={a.asset_number} sub={label("asset_types", a.asset_type)} onPress={() => navigation.navigate("Location", { id: a.id })} />)
              )}
              <View style={{ marginTop: 6 }}>
                <Badge tone="blue">Link a pole to this land from the pole's Edit screen</Badge>
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
