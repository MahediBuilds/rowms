import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../theme";
import { useLocal } from "../session";
import { addPhoto, deleteLocalDoc, docsFor, LocalDoc } from "../store";
import { quickFix } from "./Gps";
import { Button } from "./ui";

/**
 * Take a live photo or choose one from the gallery. Photos are kept on the phone
 * and uploaded automatically once the record they belong to has synced.
 */
export function Photos({
  links, linkField, category, title, label = "Photos", allowGallery = true, sensitive,
}: {
  links: Record<string, string>; // e.g. { asset: id }
  linkField: string; // which link identifies this list
  category: string;
  title?: string;
  label?: string;
  allowGallery?: boolean;
  sensitive?: boolean;
}) {
  const [docs] = useLocal(() => docsFor(linkField, links[linkField]), [links[linkField]]);
  const [busy, setBusy] = useState(false);

  const take = async (live: boolean) => {
    setBusy(true);
    try {
      const perm = live ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", live ? "Allow camera access for ROW Field in phone settings." : "Allow photo access for ROW Field in phone settings.");
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, allowsEditing: false, exif: false };
      const res = live ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 10 });
      if (res.canceled) return;
      const gps = live ? await quickFix() : null;
      for (const a of res.assets) {
        await addPhoto({ sourceUri: a.uri, category, title, links, gps, capturedLive: live });
      }
    } catch (e: any) {
      Alert.alert("Could not add photo", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (d: LocalDoc) =>
    Alert.alert("Remove photo?", "This photo has not been uploaded yet and will be deleted from the phone.", [
      { text: "Keep", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteLocalDoc(d) },
    ]);

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: C.inkSoft, marginBottom: 6 }}>{label}</Text>
      {sensitive && (
        <Text style={{ color: C.muted, fontSize: 12.5, marginBottom: 6 }}>
          Stored encrypted on the server and visible only to authorised office staff.{category === "KYC_AADHAAR" ? " Photograph the masked Aadhaar where possible." : ""}
        </Text>
      )}
      {!!docs?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 8 }}>
          {docs.map((d) => (
            <Pressable key={d.id} onLongPress={() => remove(d)} style={{ width: 96 }}>
              <Image source={{ uri: d.uri }} style={{ width: 96, height: 96, borderRadius: 6, backgroundColor: C.sunk }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 }}>
                <Ionicons
                  name={d.status === "uploaded" ? "cloud-done" : d.status === "failed" ? "alert-circle" : "cloud-upload-outline"}
                  size={14}
                  color={d.status === "uploaded" ? C.field : d.status === "failed" ? C.red : C.yellow}
                />
                <Text style={{ fontSize: 11, color: C.muted }} numberOfLines={1}>
                  {d.status === "uploaded" ? "Uploaded" : d.status === "failed" ? "Failed" : "Waiting"}
                  {d.captured_live ? ", camera" : ""}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="Take photo" icon="camera" kind="secondary" onPress={() => take(true)} busy={busy} style={{ flex: 1 }} />
        {allowGallery && <Button title="Gallery" icon="images" kind="secondary" onPress={() => take(false)} disabled={busy} style={{ flex: 1 }} />}
      </View>
      {!!docs?.length && <Text style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>Press and hold a photo that is not uploaded yet to remove it.</Text>}
    </View>
  );
}
