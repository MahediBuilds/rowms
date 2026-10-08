import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getServer, loadCredentials } from "../api";
import { Button, Card, Input } from "../components/ui";
import { useSession } from "../session";
import { C, T } from "../theme";

export function LoginScreen() {
  const { login, sync } = useSession();
  const insets = useSafeAreaInsets();
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    loadCredentials().then(() => setServer(getServer()));
  }, []);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await login(server, username.trim(), password);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.ink }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 40, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: C.yellowBright, fontWeight: "700", fontSize: T.m }}>Ipower Engineering Services</Text>
        <Text style={{ color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 6 }}>ROW Field</Text>
        <Text style={{ color: "#a9b8b1", fontSize: T.m, marginTop: 6, marginBottom: 24 }}>
          Survey poles and towers, record farmers, land, KYC and crop damage. Works without signal and uploads when you are back in range.
        </Text>
        <Card>
          {sync.authRequired && (
            <Text style={{ color: "#6d4d00", backgroundColor: C.yellowTint, padding: 10, borderRadius: 6, marginBottom: 12 }}>
              Your sign-in has ended. Sign in again with the same account; {sync.pendingChanges + sync.pendingPhotos} item(s) waiting on this phone will then upload.
            </Text>
          )}
          <Input label="Server address" value={server} onChange={setServer} autoCapitalize="none" keyboard="url" placeholder="e.g. 192.168.1.20:8000 or row.yourcompany.in" hint="Ask your administrator for this once." />
          <Input label="Username" value={username} onChange={setUsername} autoCapitalize="none" />
          <Input label="Password" value={password} onChange={setPassword} autoCapitalize="none" secure />
          {error ? <Text style={{ color: C.red, marginBottom: 12 }}>{error}</Text> : null}
          <Button title={busy ? "Signing in and downloading…" : "Sign in"} onPress={submit} busy={busy} disabled={!server || !username || !password} />
          <View style={{ height: 4 }} />
          <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 10 }}>The first sign-in downloads your assigned projects so you can work offline.</Text>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
