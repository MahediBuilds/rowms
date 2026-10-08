import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSession } from "../session";
import { C } from "../theme";
import type { RootStack } from "../nav";

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Thin status strip: offline / waiting to upload / synced. Tap for details. */
export function SyncBar() {
  const { sync, online } = useSession();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const waiting = sync.pendingChanges + sync.pendingPhotos;
  const failed = sync.failedChanges + sync.failedPhotos;
  let icon: any = "cloud-done-outline";
  let text = `All changes uploaded, synced ${timeAgo(sync.lastSync)}`;
  let bg = C.fieldTint;
  let fg = C.fieldDark;
  if (sync.syncing) {
    icon = "sync";
    text = "Syncing…";
  } else if (failed) {
    icon = "alert-circle";
    text = `${failed} item${failed === 1 ? "" : "s"} could not upload. Tap to review.`;
    bg = C.redTint;
    fg = "#8f2a23";
  } else if (!online) {
    icon = "cloud-offline-outline";
    text = waiting ? `Offline. ${waiting} item${waiting === 1 ? "" : "s"} saved on phone, will upload later.` : "Offline. You can keep working.";
    bg = C.yellowTint;
    fg = "#6d4d00";
  } else if (waiting) {
    icon = "cloud-upload-outline";
    text = `${waiting} item${waiting === 1 ? "" : "s"} waiting to upload`;
    bg = C.yellowTint;
    fg = "#6d4d00";
  } else if (sync.lastError) {
    icon = "warning-outline";
    text = `Last sync failed: ${sync.lastError}`;
    bg = C.yellowTint;
    fg = "#6d4d00";
  }
  return (
    <Pressable onPress={() => nav.navigate("Sync")} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: bg, paddingHorizontal: 14, paddingVertical: 9 }} accessibilityRole="button">
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={{ flex: 1, color: fg, fontWeight: "600" }} numberOfLines={2}>
        {text}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={fg} />
    </Pressable>
  );
}

export function ScreenTop() {
  return (
    <View>
      <SyncBar />
    </View>
  );
}
