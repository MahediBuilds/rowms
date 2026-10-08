import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SyncBar, timeAgo } from "../components/SyncBar";
import { Button, Card, IconName, Opt, P, Select } from "../components/ui";
import { useLocal, useSession } from "../session";
import { progressFor, snapshot } from "../store";
import { C, T } from "../theme";
import type { RootStack } from "../nav";

function Action({ icon, title, onPress }: { icon: IconName; title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "48%", flexGrow: 1, backgroundColor: pressed ? C.sunk : C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.line,
        padding: 14, minHeight: 92, justifyContent: "space-between",
      })}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={26} color={C.field} />
      <Text style={{ fontSize: T.m, fontWeight: "700", color: C.ink, marginTop: 8 }}>{title}</Text>
    </Pressable>
  );
}

export function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { me, projects, projectId, setProjectId, project, sync, syncNow, online } = useSession();
  const [snap] = useLocal(snapshot);

  const assets = (snap?.assets || []).filter((a) => a.project_id === projectId);
  const progress = assets.map((a) => progressFor(a, snap!.stageList, snap!.milestones, snap!.ownersOf(a.land_parcel_id)));
  const surveyed = progress.filter((p) => p.find((s) => s.code === "SURVEYED")?.completed).length;
  const noGps = assets.filter((a) => a.latitude === null || a.latitude === undefined).length;
  const farmers = (snap?.farmers || []).filter((f) => projectId && f.project_ids?.includes(projectId));
  const kycPending = farmers.filter((f) => f.kyc_status === "NOT_COLLECTED").length;

  const opts: Opt[] = projects.map((p) => ({ value: p.id, label: `${p.code}`, sub: p.name }));

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <SyncBar />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <Text style={{ fontSize: T.m, color: C.muted }}>Namaskara, {me?.display_name}</Text>
        {projects.length === 0 ? (
          <Card style={{ marginTop: 12 }}>
            <P>You are not assigned to any project yet. Ask your administrator to assign you, then sync.</P>
            <Button title="Sync now" icon="sync" onPress={() => syncNow()} busy={sync.syncing} style={{ marginTop: 10 }} />
          </Card>
        ) : (
          <>
            <View style={{ marginTop: 10 }}>
              <Select label="Working on project" value={projectId} options={opts} onChange={(v) => v && setProjectId(v)} />
            </View>
            {project && <Text style={{ color: C.muted, marginTop: -8, marginBottom: 14 }}>{project.name}</Text>}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <Action icon="flash" title="New pole / tower" onPress={() => nav.navigate("Location", {})} />
              <Action icon="person-add" title="Register farmer" onPress={() => nav.navigate("Farmer", {})} />
              <Action icon="map" title="New land record" onPress={() => nav.navigate("Land", {})} />
              <Action icon="leaf" title="Crop assessment" onPress={() => nav.navigate("Crop", {})} />
            </View>

            <Card title="This project on your phone">
              <Stat label="Poles, towers & sites" value={assets.length} />
              <Stat label="Location surveyed" value={`${surveyed} of ${assets.length}`} />
              <Stat label="Without GPS" value={noGps} warn={noGps > 0} />
              <Stat label="Farmers" value={farmers.length} />
              <Stat label="KYC not collected" value={kycPending} warn={kycPending > 0} />
            </Card>
          </>
        )}

        <Card title="Sync">
          <Stat label="Connection" value={online ? "Online" : "Offline"} warn={!online} />
          <Stat label="Waiting to upload" value={`${sync.pendingChanges} changes, ${sync.pendingPhotos} photos`} warn={sync.pendingChanges + sync.pendingPhotos > 0} />
          <Stat label="Last synced" value={timeAgo(sync.lastSync)} />
          <Button title={sync.syncing ? "Syncing…" : "Sync now"} icon="sync" kind="secondary" busy={sync.syncing} onPress={() => syncNow()} style={{ marginTop: 10 }} />
        </Card>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Text style={{ fontSize: T.m, color: C.inkSoft }}>{label}</Text>
      <Text style={{ fontSize: T.m, fontWeight: "700", color: warn ? C.yellow : C.ink }}>{value}</Text>
    </View>
  );
}
