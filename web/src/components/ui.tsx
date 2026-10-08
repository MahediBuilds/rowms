import { ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";

// ---------------------------------------------------------------- formatting

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function money(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return inr.format(n);
}

export function Money({ v, className }: { v: number | string | null | undefined; className?: string }) {
  return <span className={className ?? "nowrap"}>{money(v)}</span>;
}

function parseDate(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = parseDate(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function coords(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

// ---------------------------------------------------------------- badges

type Tone = "green" | "yellow" | "red" | "blue" | "grey";
export function Badge({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const KYC_TONE: Record<string, Tone> = { NOT_COLLECTED: "red", COLLECTED: "yellow", VERIFIED: "green" };
export const AGREEMENT_TONE: Record<string, Tone> = { DRAFT: "grey", NEGOTIATION: "yellow", EXECUTED: "green", REGISTERED: "green", CANCELLED: "red" };
export const COMP_TONE: Record<string, Tone> = { PROPOSED: "yellow", APPROVED: "green", CANCELLED: "grey" };
export const PAY_TONE: Record<string, Tone> = { UNPAID: "red", PARTIAL: "yellow", PAID: "green" };
export const PAY_LABEL: Record<string, string> = { UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid" };

// ---------------------------------------------------------------- layout bits

export function PageHead({ title, sub, crumb, actions }: { title: ReactNode; sub?: ReactNode; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="titles">
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, pad = true, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {(title || actions) && (
        <div className="panel-head">
          <h3>{title}</h3>
          {actions}
        </div>
      )}
      {pad ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h4>{title}</h4>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <div className="loading">{text}</div>;
}

export function Pager({ page, count, pageSize, onPage }: { page: number; count: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= pageSize) return null;
  return (
    <div className="pager">
      <span>
        Showing {(page - 1) * pageSize + 1}–{Math.min(count, page * pageSize)} of {count}
      </span>
      <span className="btns">
        <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- modal

export function Modal({ title, onClose, children, footer, narrow }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button.btn-primary");
    first?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${narrow ? "narrow" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="facts">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v], i) => (
          <div key={i} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
