import { FormEvent, useState } from "react";
import { ApiError } from "../api";
import { BrandMark } from "../components/Layout";
import { useAuth } from "../state";

function LineArt() {
  // Catenary spans between towers, receding to the horizon.
  const towers = [80, 260, 440, 620, 800, 980];
  const span = (x1: number, x2: number, y: number, sag: number) => `M${x1} ${y} Q${(x1 + x2) / 2} ${y + sag} ${x2} ${y}`;
  return (
    <svg className="lines" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="1000" height="700" fill="#18242E" />
      <path d="M0 560 Q300 520 520 545 T1000 530 L1000 700 L0 700 Z" fill="#1d2d27" />
      <path d="M0 610 Q260 580 560 600 T1000 590 L1000 700 L0 700 Z" fill="#22392f" />
      {towers.map((x, i) => {
        const h = 250 - i * 10;
        const base = 560 - i * 3;
        const top = base - h;
        return (
          <g key={x} stroke="#3e5664" strokeWidth={2} fill="none">
            <path d={`M${x - 22} ${base} L${x} ${top} L${x + 22} ${base}`} />
            <path d={`M${x - 34} ${top + 40} H${x + 34} M${x - 28} ${top + 80} H${x + 28}`} />
          </g>
        );
      })}
      {[40, 80].map((dy, k) =>
        towers.slice(0, -1).map((x, i) => {
          const y1 = 560 - i * 3 - (250 - i * 10) + dy;
          return <path key={`${k}-${i}`} d={span(x + 30, towers[i + 1] - 30, y1, 38)} stroke={k === 0 ? "#D9A21B" : "#5f7581"} strokeWidth={1.6} fill="none" />;
        }),
      )}
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-art">
        <LineArt />
        <div className="tag">
          <h1>Right of way, from survey to stringing.</h1>
          <p>Farmers, land records, agreements, compensation and field progress for every pole and tower on your lines.</p>
        </div>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <BrandMark className="brand-mark" />
            <div>
              <div style={{ fontWeight: 700 }}>ROW Manager</div>
              <div className="muted small">Ipower Engineering Services LLP</div>
            </div>
          </div>
          <h2>Sign in</h2>
          {error && <div className="form-error">{error}</div>}
          <label className="field">
            <span className="lbl">Username</span>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label className="field">
            <span className="lbl">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="btn btn-primary" disabled={busy || !username || !password} style={{ padding: "10px 14px" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {import.meta.env.VITE_HIDE_DEMO_HINT !== "true" && (
            <p className="muted small" style={{ marginTop: 10 }}>
              Prototype demo accounts: admin, pm, rowofficer, surveyor1, finance, management. Password for all: Demo@1234
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
