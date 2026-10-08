import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useChoices } from "../choices";
import { Photos } from "../components/Photos";
import { SyncBar } from "../components/SyncBar";
import { Badge, Button, Card, Empty, Input, NotSynced, Row, s as ui, Section, Select, Toggle } from "../components/ui";
import type { RootStack, ScreenProps } from "../nav";
import { useLocal, useSession } from "../session";
import { deleteRecord, Farmer, landLabel, linkOwner, PHONE_RE, saveRecord, snapshot } from "../store";
import { C } from "../theme";

const KYC_TONE: Record<string, "red" | "yellow" | "green"> = { NOT_COLLECTED: "red", COLLECTED: "yellow", VERIFIED: "green" };

export function FarmersScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { projectId } = useSession();
  const { label } = useChoices();
  const [snap] = useLocal(snapshot);
  const [q, setQ] = useState("");
  const [onlyKyc, setOnlyKyc] = useState(false);
  const rows = useMemo(() => {
    if (!snap) return [];
    const t = q.trim().toLowerCase();
    return snap.farmers
      .filter((f) => !projectId || !f.project_ids?.length || f.project_ids.includes(projectId))
      .filter((f) => !onlyKyc || f.kyc_status === "NOT_COLLECTED")
      .filter((f) => !t || `${f.name} ${f.farmer_code ?? ""} ${f.mobile} ${f.village} ${f.relation_name}`.toLowerCase().includes(t))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snap, q, onlyKyc, projectId]);
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search name, Farmer ID, mobile, village" placeholderTextColor={C.faint} style={ui.input} />
        <Toggle label="Only farmers without KYC" value={onlyKyc} onChange={setOnlyKyc} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(f) => f.id}
        renderItem={({ item: f }) => (
          <Row
            onPress={() => nav.navigate("Farmer", { id: f.id })}
            title={f.name}
            sub={`${f.farmer_code ?? "ID given after upload"}${f.village ? `, ${f.village}` : ""}${f.mobile ? `\n${f.mobile}` : ""}`}
            right={
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Badge tone={KYC_TONE[f.kyc_status]}>KYC {label("kyc_statuses", f.kyc_status).toLowerCase()}</Badge>
                {f._dirty && <NotSynced />}
              </View>
            }
          />
        )}
        ListEmptyComponent={<Empty title={q ? "No farmers match" : "No farmers yet"}>{q ? "" : "Register a farmer with the + button."}</Empty>}
        contentContainerStyle={{ paddingBottom: 90 }}
      />
      <Pressable
        onPress={() => nav.navigate("Farmer", {})}
        style={{ position: "absolute", right: 18, bottom: 22, width: 60, height: 60, borderRadius: 30, backgroundColor: C.field, alignItems: "center", justifyContent: "center", elevation: 4 }}
        accessibilityLabel="Register farmer"
      >
        <Ionicons name="person-add" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const EMPTY: Partial<Farmer> = {
  name: "", relation_type: "S/O", relation_name: "", mobile: "", alt_mobile: "", address: "", village: "", hobli: "", taluk: "", district: "",
  state: "Karnataka", status: "ACTIVE", aadhaar_last4: "", kyc_status: "NOT_COLLECTED", remarks: "",
};

export function FarmerScreen({ route, navigation }: ScreenProps<"Farmer">) {
  const { projectId, can } = useSession();
  const { list, label } = useChoices();
  const [snap] = useLocal(snapshot);
  const id = route.params?.id;
  // open the saved record only once the local list contains it (avoids a "not found" flash)
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (createdId && snap?.farmers?.some((x) => x.id === createdId)) {
      navigation.setParams({ id: createdId });
      setCreatedId(null);
    }
  }, [createdId, snap, navigation]);
  const farmer = id ? snap?.farmers.find((f) => f.id === id) : undefined;
  const [form, setForm] = useState<Partial<Farmer>>(EMPTY);
  const [base, setBase] = useState<Farmer | null>(null); // record as it was when editing started
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(!id);
  const [error, setError] = useState("");
  const [linkLand, setLinkLand] = useState<string | null>(route.params?.landId ?? null);
  const [primary, setPrimary] = useState(true);

  useEffect(() => {
    if (farmer && !editing) {
      setForm(farmer);
      setBase(farmer);
    }
  }, [farmer, editing]);
  useLayoutEffect(() => {
    navigation.setOptions({ title: farmer ? farmer.name : "Register farmer" });
  }, [farmer, navigation]);

  if (!snap) return null;
  if (id && !farmer) return <Empty title="Farmer not found on this phone" />;

  const set = (k: keyof Farmer, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const owned = farmer ? snap.ownerships.filter((o) => o.farmer_id === farmer.id) : [];
  const landOpts = snap.lands
    .filter((l) => !projectId || !l.project_ids?.length || l.project_ids.includes(projectId))
    .filter((l) => !owned.some((o) => o.land_id === l.id))
    .map((l) => ({ value: l.id, label: landLabel(l), sub: snap.ownersOf(l.id).map((o) => o.name).join(", ") || "No owner yet" }));
  const kycOptions = farmer?.kyc_status === "VERIFIED" ? list("kyc_statuses") : list("kyc_statuses").filter((o) => o.value !== "VERIFIED");

  const save = async () => {
    if (saving) return;
    setError("");
    if (!form.name?.trim()) return setError("Enter the farmer's name.");
    if (form.aadhaar_last4 && !/^\d{4}$/.test(form.aadhaar_last4)) return setError("Aadhaar: enter only the last 4 digits.");
    if (form.mobile && !PHONE_RE.test(form.mobile)) return setError("Check the mobile number.");
    if (form.alt_mobile && !PHONE_RE.test(form.alt_mobile)) return setError("Check the alternate mobile number.");
    setSaving(true);
    try {
      const rec: any = { ...form, id: farmer?.id, name: form.name.trim() };
      delete rec._dirty;
      if (!farmer) rec.project_ids = projectId ? [projectId] : [];
      const saved = await saveRecord<any>("farmer", rec, farmer ? base : undefined);
      if (!farmer && linkLand) await linkOwner(linkLand, saved.id, primary);
      setEditing(false);
      if (!farmer) setCreatedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const addLand = async () => {
    if (!farmer || !linkLand) return;
    await linkOwner(linkLand, farmer.id, primary);
    setLinkLand(null);
  };

  const unlink = (ownershipId: string) =>
    Alert.alert("Remove land link?", "The farmer will no longer be shown as an owner of this survey number.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteRecord("ownership", ownershipId) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {farmer && !editing && (
          <Card title={farmer.farmer_code ?? "New farmer"} right={can("farmer", "write") ? <Button title="Edit" small kind="secondary" icon="create-outline" onPress={() => setEditing(true)} /> : undefined}>
            <Text style={{ color: C.inkSoft, fontSize: 16 }}>
              {farmer.relation_name ? `${farmer.relation_type} ${farmer.relation_name}\n` : ""}
              {[farmer.village, farmer.hobli, farmer.taluk, farmer.district].filter(Boolean).join(", ")}
            </Text>
            {farmer.mobile ? <Text style={{ fontSize: 16, marginTop: 4 }}>Mobile {farmer.mobile}</Text> : null}
            <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
              <Badge tone={KYC_TONE[farmer.kyc_status]}>KYC {label("kyc_statuses", farmer.kyc_status).toLowerCase()}</Badge>
              {farmer.aadhaar_last4 ? <Badge>Aadhaar XXXX {farmer.aadhaar_last4}</Badge> : null}
              {farmer._dirty && <NotSynced />}
            </View>
            {!farmer.farmer_code && <Text style={{ color: C.muted, marginTop: 8 }}>The Farmer ID (FRM-…) is assigned when this record uploads.</Text>}
          </Card>
        )}

        {editing && (
          <Card title={farmer ? "Edit farmer" : "New farmer"}>
            <Input label="Farmer name" value={form.name} onChange={(v) => set("name", v)} required autoCapitalize="words" />
            <Select label="Relation" value={form.relation_type} options={list("relations")} onChange={(v) => set("relation_type", v || "")} />
            <Input label="Father / husband name" value={form.relation_name} onChange={(v) => set("relation_name", v)} autoCapitalize="words" />
            <Input label="Mobile" value={form.mobile} onChange={(v) => set("mobile", v)} keyboard="phone-pad" maxLength={15} />
            <Input label="Alternate mobile" value={form.alt_mobile} onChange={(v) => set("alt_mobile", v)} keyboard="phone-pad" maxLength={15} />
            <Input label="Village" value={form.village} onChange={(v) => set("village", v)} autoCapitalize="words" />
            <Input label="Hobli" value={form.hobli} onChange={(v) => set("hobli", v)} autoCapitalize="words" />
            <Input label="Taluk" value={form.taluk} onChange={(v) => set("taluk", v)} autoCapitalize="words" />
            <Input label="District" value={form.district} onChange={(v) => set("district", v)} autoCapitalize="words" />
            <Input label="Address" value={form.address} onChange={(v) => set("address", v)} multiline />
            <Section title="KYC" />
            <Input label="Aadhaar, last 4 digits only" value={form.aadhaar_last4} onChange={(v) => set("aadhaar_last4", v.replace(/\D/g, "").slice(0, 4))} keyboard="number-pad" maxLength={4} hint="Never type the full Aadhaar number." />
            <Select label="KYC status" value={form.kyc_status} options={kycOptions} onChange={(v) => set("kyc_status", v || "NOT_COLLECTED")} hint="Office staff mark KYC as verified." />
            {!farmer && (
              <>
                <Section title="Land" />
                <Select label="Owner of survey number (optional)" value={linkLand} options={landOpts} onChange={setLinkLand} allowClear />
                {linkLand && <Toggle label="Primary payee for this land" value={primary} onChange={setPrimary} />}
              </>
            )}
            <Input label="Remarks" value={form.remarks} onChange={(v) => set("remarks", v)} multiline />
            {error ? <Text style={{ color: C.red, marginBottom: 10 }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title={farmer ? "Save" : "Save farmer"} icon="checkmark" onPress={save} busy={saving} style={{ flex: 1 }} />
              {farmer && <Button title="Cancel" kind="secondary" onPress={() => setEditing(false)} />}
            </View>
          </Card>
        )}

        {farmer && (
          <>
            <Card title="KYC documents">
              <Photos links={{ farmer: farmer.id }} linkField="farmer" category="KYC_AADHAAR" title={`Aadhaar - ${farmer.name}`} label="Aadhaar card (masked if possible)" sensitive />
              {farmer.kyc_status === "NOT_COLLECTED" && (
                <Button title="Mark KYC collected" icon="checkmark-done" onPress={() => saveRecord<any>("farmer", { id: farmer.id, kyc_status: "COLLECTED" })} />
              )}
            </Card>
            <Card title="Bank passbook / cheque">
              <Photos links={{ farmer: farmer.id }} linkField="farmer" category="BANK_PROOF" title={`Bank proof - ${farmer.name}`} label="Photo of passbook or cancelled cheque" sensitive />
            </Card>
            <Card title="Land owned" right={<Button title="New land" small kind="secondary" icon="add" onPress={() => navigation.navigate("Land", { farmerId: farmer.id })} />}>
              {owned.length === 0 && <Text style={{ color: C.muted, marginBottom: 8 }}>Not linked to any survey number yet.</Text>}
              {owned.map((o) => {
                const l = snap.landById.get(o.land_id);
                const assets = snap.assets.filter((a) => a.land_parcel_id === o.land_id);
                return (
                  <Row
                    key={o.id}
                    title={landLabel(l)}
                    sub={`${o.is_primary_payee ? "Primary payee. " : ""}${assets.length ? assets.map((a) => a.asset_number).join(", ") : "No pole or tower"}`}
                    onPress={() => navigation.navigate("Land", { id: o.land_id })}
                    right={
                      can("ownership", "delete") ? (
                        <Pressable onPress={() => unlink(o.id)} hitSlop={10} accessibilityLabel="Remove land link">
                          <Ionicons name="close-circle-outline" size={22} color={C.muted} />
                        </Pressable>
                      ) : undefined
                    }
                  />
                );
              })}
              <View style={{ marginTop: 10 }}>
                <Select label="Link to existing survey number" value={linkLand} options={landOpts} onChange={setLinkLand} allowClear />
                {linkLand && (
                  <>
                    <Toggle label="Primary payee for this land" value={primary} onChange={setPrimary} />
                    <Button title="Link land" icon="link" onPress={addLand} />
                  </>
                )}
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
