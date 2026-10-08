import { CircleMarker, GeoJSON, MapContainer, TileLayer } from "react-leaflet";

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function MiniMap({ lat, lng, polygon, height = 200 }: { lat: number; lng: number; polygon?: any; height?: number }) {
  return (
    <div style={{ height, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
      <MapContainer center={[lat, lng]} zoom={16} style={{ height: "100%" }} scrollWheelZoom={false} attributionControl={true}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIB} />
        {polygon && <GeoJSON data={polygon} style={{ color: "#2b5ba6", weight: 2, fillOpacity: 0.08 }} />}
        <CircleMarker center={[lat, lng]} radius={8} pathOptions={{ color: "#18242E", weight: 2, fillColor: "#d9a21b", fillOpacity: 1 }} />
      </MapContainer>
    </div>
  );
}
