import { Alert, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { getServer } from "../api";
import { timeAgo } from "../components/SyncBar";
import { Badge, Button, Card, Row } from "../components/ui";
import { useLocal, useSession } from "../session";
import { discardDoc, discardOp, listQueue } from "../sync";
import { C, T } from "../theme";

const ENTITY_LABEL: Record<string, string> = { farmer: "Farmer", land: "Land record", ownership: "Land owner link", asset: "Pole / tower", milestone: "Progress stage", crop: "Crop assessment" };

export function SyncScreen() {
  const { sync, syncNow, online, me, logout } = useSession();
  const [queue] = useLocal(listQueue);

  const describe = (op: any) => {
    const d = JSON.parse(op.data);
    const name = d.name || d.asset_number || d.survey_number || d.crop_type || d.stage_code || "";
    return `${op.action === "delete" ? "Remove " : ""}${ENTITY_LABEL[op.entity] ?? op.entity}${name ? `: ${name}` : ""}`;
  };

  const confirmDiscard = (what: string, fn: () => void) =>
    Alert.alert("Discard this change?", `${what} will not be uploaded. This cannot be undone.`, [
      { text: "Keep", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: fn },
    ]);

  const signOut = () => {
    const waiting = sync.pendingChanges + sync.pendingPhotos;
    Alert.alert(
      "Sign out?",
      waiting ? `${waiting} item${waiting === 1 ? " has" : "s have"} not been uploaded and will be lost. Sync first if you can.` : "Data on this phone will be cleared. It downloads again when you sign in.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => logout() },
      ],
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.paper }} contentContainerStyle={{ padding: 14, paddingBottom: 50 }}>
      <Card title="Status">
        <Line k="Connection" v={online ? "Online" : "Offline"} />
        <Line k="Last synced" v={timeAgo(sync.lastSync)} />
        <Line k="Changes waiting" v={String(sync.pendingChanges)} />
        <Line k="Photos waiting" v={String(sync.pendingPhotos)} />
        {sync.lastError ? <Text style={{ color: C.red, marginTop: 8 }}>{sync.lastError}</Text> : null}
        <Button title={sync.syncing ? "Syncing…" : "Sync now"} icon="sync" busy={sync.syncing} onPress={() => syncNow()} style={{ marginTop: 12 }} />
      </Card>

      <Card title="Waiting to upload">
        {!queue || (queue.ops.length === 0 && queue.docs.length === 0) ? (
          <Text style={{ color: C.muted }}>Nothing waiting. Everything on this phone has been uploaded.</Text>
        ) : (
          <>
            {queue.ops.map((op: any) => (
              <Row
                key={op.op_id}
                title={describe(op)}
                sub={op.status === "failed" ? `Not accepted: ${op.error}` : `Saved ${timeAgo(op.created_at)}`}
                warn={op.status === "failed"}
                right={op.status === "failed" ? <Button title="Discard" small kind="danger" onPress={() => confirmDiscard(describe(op), () => discardOp(op.op_id))} /> : <Badge tone="yellow">Waiting</Badge>}
              />
            ))}
            {queue.docs.map((d: any) => (
              <Row
                key={d.id}
                title={d.title || "Photo"}
                sub={d.status === "failed" ? `Not accepted: ${d.error}` : "Uploads after its record"}
                warn={d.status === "failed"}
                right={d.status === "failed" ? <Button title="Discard" small kind="danger" onPress={() => confirmDiscard("This photo", () => discardDoc(d.id))} /> : <Badge tone="yellow">Waiting</Badge>}
              />
            ))}
            <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 8 }}>
              Items marked "Not accepted" were refused by the server, for example a stage your role cannot change. Fix the record or discard the change.
            </Text>
          </>
        )}
      </Card>

      <Card title="Download">
        <Text style={{ color: C.inkSoft, marginBottom: 10 }}>Re-download all records for your projects. Changes still waiting to upload are kept.</Text>
        <Button title="Download everything again" kind="secondary" icon="cloud-download-outline" disabled={sync.syncing} onPress={() => syncNow(true)} />
      </Card>

      <Card title="Account">
        <Line k="Signed in as" v={`${me?.display_name} (${me?.role_label})`} />
        <Line k="Server" v={getServer()} />
        <Line k="App version" v={Constants.expoConfig?.version ?? "-"} />
        <Button title="Sign out" kind="danger" icon="log-out-outline" onPress={signOut} style={{ marginTop: 12 }} />
      </Card>
    </ScrollView>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, gap: 10 }}>
      <Text style={{ fontSize: T.m, color: C.muted }}>{k}</Text>
      <Text style={{ fontSize: T.m, color: C.ink, fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{v}</Text>
    </View>
  );
}
