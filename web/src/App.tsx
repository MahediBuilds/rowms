import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { ProjectProvider, useAuth } from "./state";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import { LocationDetail, Locations } from "./pages/Locations";
import { FarmerDetail, Farmers } from "./pages/Farmers";
import { LandDetail, Lands } from "./pages/Lands";
import { AgreementDetail, Agreements } from "./pages/Agreements";
import { CompensationDetail, CompensationList, Payments } from "./pages/Money";
import { CropList } from "./pages/Crop";
import MapPage from "./pages/MapPage";
import { ProjectDetail, Projects } from "./pages/Projects";
import Reports from "./pages/Reports";
import { Activity, SettingsPage, Users } from "./pages/Admin";

export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading text="Signing in…" />;
  if (!me) return <Login />;
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="map" element={<MapPage />} />
          <Route path="locations" element={<Locations />} />
          <Route path="locations/:id" element={<LocationDetail />} />
          <Route path="farmers" element={<Farmers />} />
          <Route path="farmers/:id" element={<FarmerDetail />} />
          <Route path="lands" element={<Lands />} />
          <Route path="lands/:id" element={<LandDetail />} />
          <Route path="crop" element={<CropList />} />
          <Route path="agreements" element={<Agreements />} />
          <Route path="agreements/:id" element={<AgreementDetail />} />
          <Route path="compensation" element={<CompensationList />} />
          <Route path="compensation/:id" element={<CompensationDetail />} />
          <Route path="payments" element={<Payments />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="reports" element={<Reports />} />
          <Route path="users" element={<Users />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProjectProvider>
  );
}
