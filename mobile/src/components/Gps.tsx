import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { C, T } from "../theme";
import type { Gps } from "../store";
import { Button } from "./ui";

/**
 * GPS capture. Watches the phone's position so the surveyor can see accuracy
 * improve, then saves the position they choose. Poor accuracy only warns - it
 * never blocks saving.
 */
export function GpsCapture({ value, onCapture, limit, label = "GPS location" }: { value: Gps | null; onCapture: (g: Gps) => void; limit: number; label?: string }) {
  const [watching, setWatching] = useState(false);
  const [fix, setFix] = useState<Gps | null>(null);
  const [error, setError] = useState("");
  const sub = useRef<Location.LocationSubscription | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    try {
      sub.current?.remove();
    } catch {
      /* already stopped */
    }
    sub.current = null;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    setWatching(false);
  };
  useEffect(() => stop, []);

  const start = async () => {
    setError("");
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      setError("Location permission is off. Allow location for ROW Field in phone settings.");
      return;
    }
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      setError("Turn on Location (GPS) on the phone, then try again.");
      return;
    }
    setFix(null);
    setWatching(true);
    sub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (loc) =>
      setFix({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null, at: new Date(loc.timestamp).toISOString() }),
    );
    stopTimer.current = setTimeout(stop, 120000); // save battery if forgotten
  };

  const use = () => {
    if (fix) onCapture(fix);
    stop();
  };

  const shown = watching ? fix : value;
  const poor = !!shown && shown.accuracy !== null && shown.accuracy > limit;

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: C.inkSoft, marginBottom: 6 }}>{label}</Text>
      <View style={{ borderWidth: 1, borderColor: poor ? C.yellowBright : C.line, borderRadius: 8, backgroundColor: poor ? C.yellowTint : C.surface, padding: 12 }}>
        {shown ? (
          <>
            <Text style={{ fontSize: T.l, fontWeight: "700", color: C.ink }} selectable>
              {shown.latitude.toFixed(6)}, {shown.longitude.toFixed(6)}
            </Text>
            <Text style={{ fontSize: T.m, color: poor ? "#6d4d00" : C.field, marginTop: 2, fontWeight: "600" }}>
              {shown.accuracy !== null ? `Accuracy ±${shown.accuracy.toFixed(1)} m` : "Accuracy unknown"}
              {watching ? "  (live)" : ""}
            </Text>
            {poor && (
              <Text style={{ color: "#6d4d00", marginTop: 4 }}>
                Accuracy is worse than {limit} m. {watching ? "Wait in the open for a better fix, or save anyway." : "You can re-capture for a better fix."}
              </Text>
            )}
            {!watching && value && (
              <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps?q=${value.latitude},${value.longitude}`)} style={{ marginTop: 6 }}>
                <Text style={{ color: C.blue, fontWeight: "600" }}>Open in Google Maps</Text>
              </Pressable>
            )}
          </>
        ) : watching ? (
          <Text style={{ color: C.muted, fontSize: T.m }}>Getting a GPS fix… stand in the open if possible.</Text>
        ) : (
          <Text style={{ color: C.muted, fontSize: T.m }}>No position captured yet.</Text>
        )}
        {error ? <Text style={{ color: C.red, marginTop: 6 }}>{error}</Text> : null}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {watching ? (
            <>
              <Button title="Save this position" icon="checkmark" onPress={use} disabled={!fix} style={{ flex: 1 }} />
              <Button title="Cancel" kind="secondary" onPress={stop} />
            </>
          ) : (
            <Button title={value ? "Capture again" : "Capture GPS"} icon="locate" kind={value ? "secondary" : "primary"} onPress={start} style={{ flex: 1 }} />
          )}
        </View>
      </View>
    </View>
  );
}

/** Quick one-off position for tagging photos (does not block if unavailable). */
export async function quickFix(): Promise<Gps | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 50 });
    const loc =
      last ||
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]));
    if (!loc) return null;
    return { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null, at: new Date(loc.timestamp).toISOString() };
  } catch {
    return null;
  }
}

export function GpsBadge({ accuracy, limit }: { accuracy: number | null | undefined; limit: number }) {
  if (accuracy === undefined) return <Ionicons name="location-outline" size={18} color={C.faint} />;
  const poor = accuracy !== null && accuracy > limit;
  return <Ionicons name={poor ? "warning" : "location"} size={18} color={poor ? C.yellow : C.field} />;
}
