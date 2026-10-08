import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  FileSignature, FileSpreadsheet, FolderKanban, History, IndianRupee, Landmark, LayoutDashboard,
  Map as MapIcon, Menu, ReceiptText, Settings, Sprout, UserCog, Users, Zap,
} from "lucide-react";
import { useAuth, useProject } from "../state";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#24343F" />
      <path d="M6 25 L16 6 L26 25" fill="none" stroke="#D9A21B" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M10.5 16.5h11M8.3 21h15.4" stroke="#F2F4F1" strokeWidth="1.8" />
    </svg>
  );
}

export function Layout() {
  const { me, logout, can } = useAuth();
  const { projectId, setProjectId, projects } = useProject();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const link = (to: string, label: string, Icon: any, show = true) =>
    show ? (
      <NavLink to={to} end={to === "/"}>
        <Icon /> {label}
      </NavLink>
    ) : null;

  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div>
            <div className="brand-name">ROW Manager</div>
            <div className="brand-co">{me?.company_name ?? "Ipower Engineering Services LLP"}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {link("/", "Dashboard", LayoutDashboard)}
          {link("/map", "Map", MapIcon)}
          <div className="nav-group">Field records</div>
          {link("/locations", "Poles & towers", Zap)}
          {link("/farmers", "Farmers", Users)}
          {link("/lands", "Land records", Landmark)}
          {link("/crop", "Crop assessments", Sprout)}
          <div className="nav-group">Agreements & money</div>
          {link("/agreements", "Agreements", FileSignature)}
          {link("/compensation", "Compensation", IndianRupee, can("compensation"))}
          {link("/payments", "Payments", ReceiptText, can("payment"))}
          <div className="nav-group">Setup & reports</div>
          {link("/projects", "Projects", FolderKanban)}
          {link("/reports", "Reports", FileSpreadsheet, can("report"))}
          {link("/users", "Users", UserCog, can("user"))}
          {link("/activity", "Activity log", History, can("audit"))}
          {link("/settings", "Settings", Settings, can("settings", "write"))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{me?.display_name}</div>
          <div className="role">{me?.role_label}</div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>
            <Menu />
          </button>
          <label htmlFor="project-switch">Project</label>
          <select id="project-switch" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: "auto" }}>
            <option value="">All my projects ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} - {p.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {open && <div className="modal-bg" style={{ zIndex: 800, background: "rgba(0,0,0,.25)" }} onClick={() => setOpen(false)} />}
    </div>
  );
}
