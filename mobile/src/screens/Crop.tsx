import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useChoices } from "../choices";
import { GpsCapture } from "../components/Gps";
import { Photos } from "../components/Photos";
import { SyncBar } from "../components/SyncBar";
import { Button, Card, DateInput, Empty, Input, NotSynced, Row, Select } from "../components/ui";
import type { RootStack, ScreenProps } from "../nav";
import { useLocal, useSession } from "../session";
import { Crop, fmtDate, Gps, isValidDate, landLabel, round2, round7, saveRecord, snapshot, todayIso } from "../store";
import { C } from "../theme";

export function CropListScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { projectId } = useSession();
  const { label } = useChoices();
  const [snap] = useLocal(snapshot);
  const rows = useMemo(
    () => (snap?.crops || []).filter((c) => c.project_id === projectId).sort((a, b) => (b.assessment_date || "").localeCompare(a.assessment_date || "")),
    [snap, projectId],
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        renderItem={({ item: c }) => (
          <Row
            onPress={() => nav.navigate("Crop", { id: c.id })}
            title={`${c.crop_type}  ${c.crop_area_acres ? `${c.crop_area_acres} ac` : ""}`}
            sub={`${snap!.farmerById.get(c.farmer_id)?.name ?? ""}${c.land_parcel_id ? `, ${landLabel(snap!.landById.get(c.land_parcel_id))}` : ""}\n${fmtDate(c.assessment_date)} ${label("crop_seasons", c.season)}`}
            right={c._dirty ? <NotSynced /> : undefined}
          />
        )}
        ListEmptyComponent={<Empty title="No crop assessments in this project">Record crop damage with the + button or from a pole's page.</Empty>}
        contentContainerStyle={{ paddingBottom: 90 }}
      />
      <Pressable
        onPress={() => nav.navigate("Crop", {})}
        style={{ position: "absolute", right: 18, bottom: 22, width: 60, height: 60, borderRadius: 30, backgroundColor: C.field, alignItems: "center", justifyContent: "center", elevation: 4 }}
        accessibilityLabel="New crop assessment"
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
    </View>
  );
}

export function CropScreen({ route, navigation }: ScreenProps<"Crop">) {
  const { projectId, gpsLimit } = useSession();
  const { list } = useChoices();
  const [snap] = useLocal(snapshot);
  const id = route.params?.id;
  // open the saved record only once the local list contains it (avoids a "not found" flash)
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (createdId && snap?.crops?.some((x) => x.id === createdId)) {
      navigation.setParams({ id: createdId });
      setCreatedId(null);
    }
  }, [createdId, snap, navigation]);
  const crop = id ? snap?.crops.find((c) => c.id === id) : undefined;
  const [form, setForm] = useState<Partial<Crop>>({
    farmer_id: route.params?.farmerId, land_parcel_id: route.params?.landId ?? null, asset_id: route.params?.assetId ?? null,
    assessment_date: todayIso(), season: "KHARIF", crop_type: "", crop_stage: "", crop_area_acres: "", field_inspection_notes: "",
    revenue_assessment: "", company_assessment: "",
  });
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsChanged, setGpsChanged] = useState(false); // only send GPS when re-captured on this phone
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [base, setBase] = useState<Crop | null>(null); // record as loaded into the form

  useEffect(() => {
    if (crop && !loaded) {
      setForm({ ...crop, crop_area_acres: crop.crop_area_acres ?? "", revenue_assessment: crop.revenue_assessment ?? "", company_assessment: crop.company_assessment ?? "" });
      setBase(crop);
      if (crop.latitude !== null && crop.latitude !== undefined)
        setGps({ latitude: Number(crop.latitude), longitude: Number(crop.longitude), accuracy: crop.gps_accuracy_m === null || crop.gps_accuracy_m === undefined ? null : Number(crop.gps_accuracy_m), at: crop.gps_captured_at || "" });
      setLoaded(true);
    }
  }, [crop, loaded]);
  useLayoutEffect(() => navigation.setOptions({ title: crop ? `Crop: ${crop.crop_type}` : "Crop assessment" }), [crop, navigation]);

  if (!snap) return null;
  if (id && !crop) return <Empty title="Assessment not found on this phone" />;
  const projId = crop?.project_id || projectId;
  const set = (k: keyof Crop, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const farmerOpts = snap.farmers
    .filter((f) => !projId || !f.project_ids?.length || f.project_ids.includes(projId))
    .map((f) => ({ value: f.id, label: f.name, sub: `${f.farmer_code ?? "New"}${f.village ? `, ${f.village}` : ""}` }));
  const landsOfFarmer = form.farmer_id ? snap.ownerships.filter((o) => o.farmer_id === form.farmer_id).map((o) => o.land_id) : [];
  const landOpts = snap.lands
    .filter((l) => landsOfFarmer.includes(l.id) || !form.farmer_id)
    .map((l) => ({ value: l.id, label: landLabel(l) }));
  const assetOpts = snap.assets
    .filter((a) => a.project_id === projId && (!form.land_parcel_id || a.land_parcel_id === form.land_parcel_id))
    .map((a) => ({ value: a.id, label: a.asset_number }));
  const num = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));

  const save = async () => {
    if (saving) return;
    setError("");
    if (!projId) return setError("Choose a project on the Home tab first.");
    if (!form.farmer_id) return setError("Choose the farmer.");
    if (!form.crop_type?.trim()) return setError("Enter the crop.");
    if (form.assessment_date && !isValidDate(form.assessment_date)) return setError("Enter the assessment date as YYYY-MM-DD, e.g. 2026-10-08.");
    const area = num(form.crop_area_acres);
    const rev = num(form.revenue_assessment);
    const comp = num(form.company_assessment);
    if ([area, rev, comp].some((v) => v !== null && (Number.isNaN(v) || v < 0))) return setError("Area and amounts must be positive numbers.");
    setSaving(true);
    try {
      const rec: any = {
        id: crop?.id, project_id: projId, farmer_id: form.farmer_id, land_parcel_id: form.land_parcel_id || null, asset_id: form.asset_id || null,
        season: form.season || "", crop_type: form.crop_type.trim(), crop_area_acres: area === null ? null : Math.round(area * 1000) / 1000,
        crop_stage: form.crop_stage || "", assessment_date: form.assessment_date || null, field_inspection_notes: form.field_inspection_notes || "",
        revenue_assessment: rev === null ? null : round2(rev), company_assessment: comp === null ? null : round2(comp),
      };
      if (gps && gpsChanged)
        Object.assign(rec, { latitude: round7(gps.latitude), longitude: round7(gps.longitude), gps_accuracy_m: gps.accuracy !== null ? round2(gps.accuracy) : null, gps_captured_at: gps.at || null });
      const saved = await saveRecord<any>("crop", rec, crop ? base : undefined);
      setGpsChanged(false);
      if (!crop) setCreatedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Card title={crop ? "Assessment" : "New assessment"} right={crop?._dirty ? <NotSynced /> : undefined}>
          <Select label="Farmer" value={form.farmer_id} options={farmerOpts} onChange={(v) => setForm((f) => ({ ...f, farmer_id: v || undefined, land_parcel_id: null, asset_id: null }))} required />
          <Select label="Land (survey number)" value={form.land_parcel_id} options={landOpts} onChange={(v) => set("land_parcel_id", v)} allowClear />
          <Select label="Pole / tower" value={form.asset_id} options={assetOpts} onChange={(v) => set("asset_id", v)} allowClear />
          <DateInput label="Assessment date" value={form.assessment_date} onChange={(v) => set("assessment_date", v)} />
          <Input label="Crop" value={form.crop_type} onChange={(v) => set("crop_type", v)} required autoCapitalize="words" placeholder="e.g. Maize, Groundnut, Cotton" />
          <Select label="Season" value={form.season} options={list("crop_seasons")} onChange={(v) => set("season", v || "")} allowClear />
          <Select label="Crop stage" value={form.crop_stage} options={list("crop_stages")} onChange={(v) => set("crop_stage", v || "")} allowClear />
          <Input label="Affected area (acres)" value={form.crop_area_acres as any} onChange={(v) => set("crop_area_acres", v)} keyboard="decimal-pad" />
          <Input label="Field inspection notes" value={form.field_inspection_notes} onChange={(v) => set("field_inspection_notes", v)} multiline />
          <Input label="Revenue department assessment (₹)" value={form.revenue_assessment as any} onChange={(v) => set("revenue_assessment", v)} keyboard="decimal-pad" />
          <Input label="Company assessment (₹)" value={form.company_assessment as any} onChange={(v) => set("company_assessment", v)} keyboard="decimal-pad" />
          <GpsCapture
            value={gps}
            onCapture={(g) => {
              setGps(g);
              setGpsChanged(true);
            }}
            limit={gpsLimit}
            label="GPS of affected area"
          />
          {error ? <Text style={{ color: C.red, marginBottom: 10 }}>{error}</Text> : null}
          <Button title={crop ? "Save changes" : "Save assessment"} icon="checkmark" onPress={save} busy={saving} />
          <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 8 }}>Approved amounts and payments are entered by the office.</Text>
        </Card>
        {crop ? (
          <Card title="Crop photos">
            <Photos links={{ crop_assessment: crop.id, farmer: crop.farmer_id }} linkField="crop_assessment" category="CROP_PHOTO" title={`${crop.crop_type} damage`} label="Photos of the damage" />
          </Card>
        ) : (
          <Text style={{ color: C.muted, textAlign: "center" }}>Save the assessment to add photos.</Text>
        )}
      </ScrollView>
    </View>
  );
}
