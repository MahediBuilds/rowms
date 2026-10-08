import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, qs } from "../api";
import { useMeta } from "../state";
import type { Choice, Meta } from "../types";
import { Modal } from "./ui";

// ---------------------------------------------------------------- reference picker

export type RefConfig = {
  endpoint: string; // e.g. "farmers"
  label: (item: any) => string;
  params?: Record<string, any>;
};

export const REFS = {
  farmer: { endpoint: "farmers", label: (f: any) => `${f.farmer_code ?? "New"} ${f.name}${f.village ? `, ${f.village}` : ""}` },
  land: { endpoint: "lands", label: (l: any) => `Sy.No. ${l.survey_label}, ${l.village}` },
  asset: { endpoint: "assets", label: (a: any) => `${a.asset_number} (${a.project_code})` },
  project: { endpoint: "projects", label: (p: any) => `${p.code} - ${p.name}` },
  compensation: { endpoint: "compensations", label: (c: any) => `${c.payee_name}, ${c.category.toLowerCase().replace("_", " ")}, ₹${c.approved_amount}` },
  crop: { endpoint: "crop-assessments", label: (c: any) => `${c.crop_type}, ${c.farmer_name}${c.assessment_date ? ` (${c.assessment_date})` : ""}` },
} satisfies Record<string, RefConfig>;

function useRefLabel(cfg: RefConfig, id: string | null | undefined) {
  const { data } = useQuery({
    queryKey: [cfg.endpoint, "one", id],
    queryFn: () => api(`${cfg.endpoint}/${id}/`),
    enabled: !!id,
    staleTime: 60_000,
  });
  return data ? cfg.label(data) : id ? "…" : "";
}

function RefSearch({ cfg, onPick, exclude = [], placeholder }: { cfg: RefConfig; onPick: (item: any) => void; exclude?: string[]; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 220);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: [cfg.endpoint, "search", debounced, cfg.params],
    queryFn: () => api(`${cfg.endpoint}/${qs({ search: debounced, page_size: 15, ...cfg.params })}`),
    enabled: open,
  });
  const items = ((data?.results as any[]) || []).filter((x) => !exclude.includes(String(x.id)));
  const pick = (item: any) => {
    onPick(item);
    setQ("");
    setOpen(false);
  };
  return (
    <div className="ref">
      <input
        type="search"
        value={q}
        placeholder={placeholder ?? "Type to search"}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHl(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHl((h) => Math.min(h + 1, items.length - 1));
          else if (e.key === "ArrowUp") setHl((h) => Math.max(h - 1, 0));
          else if (e.key === "Enter" && items[hl]) {
            e.preventDefault();
            pick(items[hl]);
          }
        }}
      />
      {open && (
        <div className="ref-list">
          {items.map((it, i) => (
            <button type="button" key={it.id} className={i === hl ? "hl" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}>
              {cfg.label(it)}
            </button>
          ))}
          {!items.length && <div className="none">{isFetching ? "Searching…" : "No matches"}</div>}
        </div>
      )}
    </div>
  );
}

export function RefSelect({ cfg, value, onChange, placeholder }: { cfg: RefConfig; value: string | null; onChange: (id: string | null, item?: any) => void; placeholder?: string }) {
  const label = useRefLabel(cfg, value);
  if (value) {
    return (
      <div className="chips" style={{ marginBottom: 0 }}>
        <span className="chip">
          {label}
          <button type="button" aria-label="Clear" onClick={() => onChange(null)}>
            ×
          </button>
        </span>
      </div>
    );
  }
  return <RefSearch cfg={cfg} onPick={(it) => onChange(String(it.id), it)} placeholder={placeholder} />;
}

export function RefMulti({ cfg, value, labels, onChange }: { cfg: RefConfig; value: string[]; labels?: Record<string, string>; onChange: (ids: string[], labels: Record<string, string>) => void }) {
  const [known, setKnown] = useState<Record<string, string>>(labels || {});
  return (
    <div>
      {value.length > 0 && (
        <div className="chips">
          {value.map((id) => (
            <span className="chip" key={id}>
              {known[id] ?? id.slice(0, 8)}
              <button type="button" aria-label="Remove" onClick={() => onChange(value.filter((x) => x !== id), known)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <RefSearch
        cfg={cfg}
        exclude={value}
        placeholder="Add…"
        onPick={(it) => {
          const k = { ...known, [String(it.id)]: cfg.label(it) };
          setKnown(k);
          onChange([...value, String(it.id)], k);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- generic form

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "checkbox" | "ref" | "refs" | "section" | "tel" | "email" | "password";
  options?: keyof Meta | Choice[];
  ref?: RefConfig;
  refLabels?: Record<string, string>;
  span?: 2;
  hint?: string;
  required?: boolean;
  blank?: string; // label of empty select option
  show?: (v: Record<string, any>) => boolean;
  disabled?: boolean;
  step?: string;
  maxLength?: number;
};

export function FieldInput({ def, value, onChange, error }: { def: FieldDef; value: any; onChange: (v: any) => void; error?: string }) {
  const meta = useMeta();
  const opts: Choice[] = useMemo(() => {
    if (!def.options) return [];
    return typeof def.options === "string" ? ((meta?.[def.options] as Choice[]) || []) : def.options;
  }, [def.options, meta]);
  const id = `f-${def.name}`;
  if (def.type === "section") return <div className="form-section">{def.label}</div>;
  if (def.type === "checkbox") {
    return (
      <label className={`check ${def.span === 2 ? "span-2" : ""}`}>
        <input type="checkbox" checked={!!value} disabled={def.disabled} onChange={(e) => onChange(e.target.checked)} /> {def.label}
      </label>
    );
  }
  let input: ReactNode;
  switch (def.type) {
    case "textarea":
      input = <textarea id={id} value={value ?? ""} disabled={def.disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      input = (
        <select id={id} value={value ?? ""} disabled={def.disabled} onChange={(e) => onChange(e.target.value)}>
          {(def.blank !== undefined || !def.required) && <option value="">{def.blank ?? "—"}</option>}
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "ref":
      input = <RefSelect cfg={def.ref!} value={value || null} onChange={(v) => onChange(v)} />;
      break;
    case "refs":
      input = <RefMulti cfg={def.ref!} value={value || []} labels={def.refLabels} onChange={(v) => onChange(v)} />;
      break;
    case "number":
      input = <input id={id} type="number" step={def.step ?? "any"} value={value ?? ""} disabled={def.disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      input = (
        <input
          id={id}
          type={def.type ?? "text"}
          value={value ?? ""}
          disabled={def.disabled}
          maxLength={def.maxLength}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={def.type === "password" ? "new-password" : "off"}
        />
      );
  }
  return (
    <label className={`field ${def.span === 2 ? "span-2" : ""} ${error ? "has-err" : ""}`} htmlFor={def.type === "ref" || def.type === "refs" ? undefined : id}>
      <span className="lbl">
        {def.label}
        {def.required ? " *" : ""}
      </span>
      {input}
      {error ? <span className="err">{error}</span> : def.hint ? <span className="hint">{def.hint}</span> : null}
    </label>
  );
}

function cleanForSubmit(fields: FieldDef[], values: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (f.type === "section" || f.disabled) continue;
    if (f.show && !f.show(values)) continue;
    let v = values[f.name];
    if (f.type === "number" || f.type === "date" || f.type === "ref") v = v === "" || v === undefined ? null : v;
    if (f.type === "select" && v === undefined) v = "";
    if (f.type === "password" && !v) continue;
    out[f.name] = v;
  }
  return out;
}

export function FormModal({
  title,
  fields,
  initial,
  onSubmit,
  onClose,
  submitLabel = "Save",
  intro,
}: {
  title: string;
  fields: FieldDef[];
  initial: Record<string, any>;
  onSubmit: (values: Record<string, any>) => Promise<any>;
  onClose: () => void;
  submitLabel?: string;
  intro?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && (!f.show || f.show(values))) {
        const v = values[f.name];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) missing[f.name] = "Required";
      }
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      setFormError("Fill in the required fields.");
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError("");
    try {
      await onSubmit(cleanForSubmit(fields, values));
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        const known = Object.fromEntries(Object.entries(fe).filter(([k]) => fields.some((f) => f.name === k)));
        setErrors(known);
        setFormError(Object.keys(known).length ? "Check the highlighted fields." : err.message);
      } else setFormError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit()}>
            {busy ? "Saving…" : submitLabel}
          </button>
        </>
      }
    >
      {intro}
      {formError && <div className="form-error">{formError}</div>}
      <form ref={formRef} onSubmit={submit} className="form-grid">
        {fields
          .filter((f) => !f.show || f.show(values))
          .map((f) => (
            <FieldInput key={f.name} def={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
          ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
