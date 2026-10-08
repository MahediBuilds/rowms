import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useChoices } from "../choices";
import { GpsBadge, GpsCapture } from "../components/Gps";
import { Photos } from "../components/Photos";
import { SyncBar } from "../components/SyncBar";
import { Badge, Button, Card, DateInput, Empty, Input, NotSynced, ProgressStrip, Row, s as ui, Select, Toggle } from "../components/ui";
import { all } from "../db";
import type { RootStack, ScreenProps } from "../nav";
import { useLocal, useSession } from "../session";
import { Asset, fmtDate, Gps, isValidDate, landLabel, Milestone, progressFor, round2, round7, saveRecord, setStage, snapshot, StageState, todayIso } from "../store";
import { C, T } from "../theme";

const natural = (x: string) => x.replace(/\d+/g, (d) => d.padStart(6, "0"));

export function LocationsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { projectId, gpsLimit, stages } = useSession();
  const { label } = useChoices();
  const [snap] = useLocal(snapshot);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("");

  const rows = useMemo(() => {
    if (!snap) return [];
    const t = q.trim().toLowerCase();
    return snap.assets
      .filter((a) => a.project_id === projectId)
      .map((a) => {
        const owners = snap.ownersOf(a.land_parcel_id);
        const land = a.land_parcel_id ? snap.landById.get(a.land_parcel_id) : null;
        return { a, owners, land, progress: progressFor(a, snap.stageList, snap.milestones, owners) };
      })
      .filter(({ a, owners, land, progress }) => {
        if (filter === "NOGPS" && a.latitude !== null && a.latitude !== undefined) return false;
        if (filter && filter !== "NOGPS" && progress.find((p) => p.code === filter)?.completed) return false;
        if (!t) return true;
        return `${a.asset_number} ${a.line_name} ${landLabel(land)} ${owners.map((o) => o.name).join(" ")}`.toLowerCase().includes(t);
      })
      .sort((x, y) => natural(x.a.asset_number).localeCompare(natural(y.a.asset_number)));
  }, [snap, q, filter, projectId]);

  const filterOpts = [{ value: "NOGPS", label: "GPS not captured" }, ...stages.map((st) => ({ value: st.code, label: `${st.name}: pending` }))];

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <View style={{ padding: 12, paddingBottom: 0, gap: 0 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search pole no., survey no., farmer" placeholderTextColor={C.faint} style={[ui.input, { marginBottom: 8 }]} />
        <Select label="Show" value={filter} options={filterOpts} onChange={(v) => setFilter(v || "")} placeholder="All locations" allowClear />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.a.id}
        renderItem={({ item: { a, owners, land, progress } }) => (
          <Row
            onPress={() => nav.navigate("Location", { id: a.id })}
            left={<GpsBadge accuracy={a.latitude === null || a.latitude === undefined ? undefined : a.gps_accuracy_m} limit={gpsLimit} />}
            title={`${a.asset_number}  ${label("asset_types", a.asset_type)}`}
            sub={land ? `${landLabel(land)}${owners.length ? `\n${owners.map((o) => o.name).join(", ")}` : ""}` : "No land linked"}
            right={
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <ProgressStrip stages={progress} />
                {a._dirty && <NotSynced />}
              </View>
            }
          />
        )}
        ListEmptyComponent={<Empty title={q || filter ? "No locations match" : "No locations yet"}>{q || filter ? "" : "Add the first pole or tower with the + button."}</Empty>}
        contentContainerStyle={{ paddingBottom: 90 }}
      />
      <Pressable
        onPress={() => nav.navigate("Location", {})}
        style={{ position: "absolute", right: 18, bottom: 22, width: 60, height: 60, borderRadius: 30, backgroundColor: C.field, alignItems: "center", justifyContent: "center", elevation: 4 }}
        accessibilityLabel="Add pole or tower"
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------- location detail / create

export function LocationScreen({ route, navigation }: ScreenProps<"Location">) {
  const { projectId, project, gpsLimit, canEditStage, can } = useSession();
  const { list, label } = useChoices();
  const [snap] = useLocal(snapshot);
  const id = route.params?.id;
  // open the saved record only once the local list contains it (avoids a "not found" flash)
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (createdId && snap?.assets?.some((x) => x.id === createdId)) {
      navigation.setParams({ id: createdId });
      setCreatedId(null);
    }
  }, [createdId, snap, navigation]);
  const asset = id ? snap?.assets.find((a) => a.id === id) : undefined;
  const isNew = !id;
  const [editing, setEditing] = useState(isNew);
  const [form, setForm] = useState<Partial<Asset>>({ asset_type: "POLE", asset_number: "", line_name: "", land_parcel_id: null, remarks: "" });
  const [base, setBase] = useState<Asset | null>(null);
  const [saving, setSaving] = useState(false);
  const [gps, setGps] = useState<Gps | null>(null);
  const [markSurveyed, setMarkSurveyed] = useState(true);
  const [stageOpen, setStageOpen] = useState<StageState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (asset && !editing) {
      setForm(asset);
      setBase(asset);
    }
  }, [asset, editing]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: asset ? `${label("asset_types", asset.asset_type)} ${asset.asset_number}` : "New pole / tower" });
  }, [asset, navigation, label]);

  if (!snap) return null;
  if (id && !asset) return <Empty title="Location not found on this phone">It may have been removed. Sync to refresh.</Empty>;

  const projId = asset?.project_id || projectId;
  const lands = snap.lands.filter((l) => !projId || !l.project_ids?.length || l.project_ids.includes(projId));
  const landOpts = lands.map((l) => ({ value: l.id, label: landLabel(l), sub: snap.ownersOf(l.id).map((o) => o.name).join(", ") || "No owner linked" }));
  const owners = asset ? snap.ownersOf(asset.land_parcel_id) : [];
  const progress = asset ? progressFor(asset, snap.stageList, snap.milestones, owners) : [];
  const crops = asset ? snap.crops.filter((c) => c.asset_id === asset.id) : [];
  const set = (k: keyof Asset, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const saveDetails = async () => {
    if (saving) return;
    setError("");
    const number = (form.asset_number || "").trim();
    if (!number) return setError("Enter the pole / tower number.");
    if (!projId) return setError("Choose a project on the Home tab first.");
    const dup = snap.assets.find((a) => a.project_id === projId && a.asset_number.toUpperCase() === number.toUpperCase() && a.id !== asset?.id);
    if (dup) return setError(`${number} already exists in this project.`);
    setSaving(true);
    try {
      const rec: any = {
        id: asset?.id, project_id: projId, asset_type: form.asset_type, asset_number: number, line_name: form.line_name || "",
        land_parcel_id: form.land_parcel_id || null, remarks: form.remarks || "",
      };
      if (gps) Object.assign(rec, { latitude: round7(gps.latitude), longitude: round7(gps.longitude), gps_accuracy_m: gps.accuracy !== null ? round2(gps.accuracy) : null, gps_captured_at: gps.at || null });
      const saved = await saveRecord<any>("asset", rec, asset ? base : undefined);
      if (isNew && markSurveyed && canEditStage("SURVEYED")) await setStage(saved, "SURVEYED", true, todayIso(), "", gps);
      setEditing(false);
      if (isNew) setCreatedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const saveGps = async (g: Gps) => {
    if (!asset) return setGps(g);
    await saveRecord<any>("asset", { id: asset.id, latitude: round7(g.latitude), longitude: round7(g.longitude), gps_accuracy_m: g.accuracy !== null ? round2(g.accuracy) : null, gps_captured_at: g.at });
  };

  const assetGps: Gps | null = asset && asset.latitude !== null && asset.latitude !== undefined
    ? { latitude: Number(asset.latitude), longitude: Number(asset.longitude), accuracy: asset.gps_accuracy_m === null ? null : Number(asset.gps_accuracy_m), at: asset.gps_captured_at || "" }
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {asset && !editing && (
          <Card
            title={project ? project.code : "Location"}
            right={
              can("asset", "write") ? (
                <Button title="Edit" kind="secondary" small icon="create-outline" onPress={() => setEditing(true)} />
              ) : undefined
            }
          >
            <Text style={{ fontSize: T.m, color: C.inkSoft }}>{asset.line_name || "No line name"}</Text>
            {asset.remarks ? <Text style={{ color: C.muted, marginTop: 4 }}>{asset.remarks}</Text> : null}
            {asset._dirty && <View style={{ marginTop: 8 }}><NotSynced /></View>}
          </Card>
        )}

        {editing && (
          <Card title={isNew ? "Details" : "Edit details"}>
            <Select label="Type" value={form.asset_type} options={list("asset_types")} onChange={(v) => set("asset_type", v || "POLE")} required />
            <Input label="Pole / tower number" value={form.asset_number} onChange={(v) => set("asset_number", v)} required autoCapitalize="characters" placeholder="e.g. P-245" />
            <Input label="Line / corridor" value={form.line_name} onChange={(v) => set("line_name", v)} />
            <Select label="Land (survey number)" value={form.land_parcel_id} options={landOpts} onChange={(v) => set("land_parcel_id", v)} allowClear hint="Farmers on this land are linked automatically. Add new land from the Land tab." />
            <Input label="Remarks" value={form.remarks} onChange={(v) => set("remarks", v)} multiline />
            {isNew && <GpsCapture value={gps} onCapture={setGps} limit={gpsLimit} />}
            {isNew && canEditStage("SURVEYED") && <Toggle label="Mark 'Farmer Location Surveyed' as done" value={markSurveyed} onChange={setMarkSurveyed} />}
            {error ? <Text style={{ color: C.red, marginBottom: 10 }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title={isNew ? "Save location" : "Save"} icon="checkmark" onPress={saveDetails} busy={saving} style={{ flex: 1 }} />
              {!isNew && <Button title="Cancel" kind="secondary" onPress={() => setEditing(false)} />}
            </View>
          </Card>
        )}

        {asset && (
          <>
            <Card title="Progress" right={<ProgressStrip stages={progress} />}>
              {progress.map((st) => {
                const editable = st.scope !== "FARMER" && canEditStage(st.code);
                return (
                  <Pressable
                    key={st.code}
                    onPress={() => (st.scope === "FARMER" ? owners[0] && navigation.navigate("Farmer", { id: owners[0].id }) : editable ? setStageOpen(st) : null)}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: "#E8ECE8", opacity: pressed ? 0.7 : 1 })}
                    accessibilityRole="button"
                    accessibilityLabel={`${st.name}: ${st.completed ? "done" : "pending"}`}
                  >
                    <View style={[ui.tick, st.completed && { backgroundColor: C.field, borderColor: C.field }, st.partial && { backgroundColor: C.yellowBright, borderColor: C.yellowBright }]}>
                      {(st.completed || st.partial) && <Ionicons name="checkmark" size={18} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: T.m, fontWeight: "700", color: C.ink }}>{st.name}</Text>
                      <Text style={{ fontSize: T.s, color: C.muted }}>
                        {st.scope === "FARMER" ? `${st.detail}. Updated on the farmer record.` : st.completed ? `Done ${fmtDate(st.completed_on)}${st.milestone?.source === "AUTO" ? " (automatic)" : ""}` : editable ? "Tap to mark done" : "Updated by office staff"}
                      </Text>
                    </View>
                    {st.milestone?._dirty && <NotSynced />}
                  </Pressable>
                );
              })}
            </Card>

            <Card title="GPS">
              <GpsCapture value={assetGps} onCapture={saveGps} limit={gpsLimit} label="Pole / tower position" />
            </Card>

            <Card title="Land & farmers">
              {asset.land_parcel_id ? (
                <Row title={landLabel(snap.landById.get(asset.land_parcel_id))} sub="Open land record" onPress={() => navigation.navigate("Land", { id: asset.land_parcel_id! })} />
              ) : (
                <Text style={{ color: C.muted, marginBottom: 8 }}>No land linked. Use Edit to choose the survey number.</Text>
              )}
              {owners.map((f) => (
                <Row
                  key={f.id}
                  title={f.name}
                  sub={`${f.farmer_code ?? "New farmer"}${f.mobile ? `, ${f.mobile}` : ""}`}
                  right={<Badge tone={f.kyc_status === "NOT_COLLECTED" ? "red" : f.kyc_status === "VERIFIED" ? "green" : "yellow"}>KYC {label("kyc_statuses", f.kyc_status).toLowerCase()}</Badge>}
                  onPress={() => navigation.navigate("Farmer", { id: f.id })}
                />
              ))}
            </Card>

            <Card title="Site photos">
              <Photos links={{ asset: asset.id }} linkField="asset" category="SITE_PHOTO" title={`${asset.asset_number} site photo`} label="Photos of this location" />
            </Card>

            <Card title="Crop assessments" right={<Button title="New" small icon="add" kind="secondary" onPress={() => navigation.navigate("Crop", { assetId: asset.id, landId: asset.land_parcel_id || undefined, farmerId: owners[0]?.id })} />}>
              {crops.length === 0 ? (
                <Text style={{ color: C.muted }}>None recorded for this location.</Text>
              ) : (
                crops.map((c) => (
                  <Row key={c.id} title={c.crop_type} sub={`${fmtDate(c.assessment_date)} ${snap.farmerById.get(c.farmer_id)?.name ?? ""}`} onPress={() => navigation.navigate("Crop", { id: c.id })} />
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
      {stageOpen && asset && <StageSheet asset={asset} stage={stageOpen} onClose={() => setStageOpen(null)} />}
    </View>
  );
}

function StageSheet({ asset, stage, onClose }: { asset: Asset; stage: StageState; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(stage.completed_on || todayIso());
  const [remarks, setRemarks] = useState(stage.milestone?.source === "AUTO" ? "" : stage.milestone?.remarks || "");
  const [milestones] = useLocal(() => all<Milestone>("milestone"));
  const current = milestones?.find((m) => m.asset_id === asset.id && m.stage_code === stage.code);

  const save = async (done: boolean) => {
    if (done && !isValidDate(date)) return Alert.alert("Check the date", "Enter a real date in the format YYYY-MM-DD, e.g. 2026-10-08.");
    if (done && date > todayIso()) return Alert.alert("Check the date", "The completion date cannot be in the future.");
    await setStage(asset, stage.code, done, done ? date : null, remarks);
    if (!done) onClose();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.paper, paddingTop: insets.top }}>
        <View style={ui.modalHead}>
          <Text style={ui.modalTitle}>{stage.name}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: C.muted, marginBottom: 12 }}>
            {asset.asset_number}. Stages can be marked in any order.{current?.completed ? ` Currently done on ${fmtDate(current.completed_on)}.` : " Currently pending."}
          </Text>
          <DateInput label="Completed on" value={date} onChange={setDate} />
          <Input label="Remarks" value={remarks} onChange={setRemarks} multiline />
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            <Button title={current?.completed ? "Save" : "Mark done"} icon="checkmark" onPress={() => save(true)} style={{ flex: 1 }} />
            {current?.completed && <Button title="Mark pending" kind="danger" onPress={() => save(false)} />}
          </View>
          {current && (
            <Card title="Photos for this stage">
              <Photos links={{ asset: asset.id, milestone: current.id }} linkField="milestone" category="SITE_PHOTO" title={`${asset.asset_number} ${stage.name}`} label="Proof photos" />
            </Card>
          )}
          {!current && <Text style={{ color: C.muted }}>Mark the stage done to attach proof photos.</Text>}
          <Button title="Done" kind="secondary" onPress={onClose} style={{ marginTop: 6 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}
