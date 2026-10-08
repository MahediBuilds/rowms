import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Lock, MapPin, Upload } from "lucide-react";
import { api, ApiError, qs } from "../api";
import { useAuth, useMeta, useToast } from "../state";
import type { Doc, Paged } from "../types";
import { Empty, fmtDate, Modal } from "./ui";

type Props = {
  filter: Record<string, string>; // e.g. { asset: id }
  categories?: string[]; // allowed upload categories
  defaultCategory?: string;
  title?: string;
  compact?: boolean;
};

export function Documents({ filter, categories, defaultCategory = "SITE_PHOTO", compact }: Props) {
  const { can } = useAuth();
  const { data } = useQuery({
    queryKey: ["documents", filter],
    queryFn: () => api<Paged<Doc>>(`documents/${qs({ ...filter, page_size: 200 })}`),
  });
  const [uploading, setUploading] = useState(false);
  const docs = data?.results || [];
  return (
    <div>
      {docs.length === 0 ? (
        compact ? <p className="muted small">No documents or photos yet.</p> : <Empty title="No documents or photos yet" />
      ) : (
        <div className="docs">
          {docs.map((d) => (
            <DocCard key={d.id} d={d} />
          ))}
        </div>
      )}
      {can("document", "write") && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-small" onClick={() => setUploading(true)}>
            <Upload /> Upload file
          </button>
        </div>
      )}
      {uploading && <UploadModal filter={filter} categories={categories} defaultCategory={defaultCategory} onClose={() => setUploading(false)} />}
    </div>
  );
}

function DocCard({ d }: { d: Doc }) {
  const isImage = d.content_type.startsWith("image/") && d.content_type !== "image/heic";
  const label = d.title || d.original_name || d.category_label;
  const body = (
    <>
      <div className="thumb">
        {!d.can_view ? (
          <Lock aria-label="Restricted" />
        ) : isImage && d.download_url ? (
          <img src={d.download_url} alt={label} loading="lazy" />
        ) : (
          <FileText />
        )}
      </div>
      <div className="cap">
        <div className="t" title={label}>
          {label}
        </div>
        <div className="muted">
          {d.category_label}
          {d.is_sensitive ? ", restricted" : ""}
        </div>
        <div className="muted">
          {fmtDate(d.captured_at || d.created_at)}
          {d.captured_live ? ", camera" : ""}
        </div>
        {d.latitude !== null && (
          <div className="muted" title={`GPS ${d.latitude}, ${d.longitude}`}>
            <MapPin style={{ width: 12, height: 12, verticalAlign: -1 }} /> {Number(d.latitude).toFixed(5)}, {Number(d.longitude).toFixed(5)}
          </div>
        )}
      </div>
    </>
  );
  return d.can_view && d.download_url ? (
    <a className="doc" href={d.download_url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
      {body}
    </a>
  ) : (
    <div className="doc" title="Your role cannot open this document">
      {body}
    </div>
  );
}

function UploadModal({ filter, categories, defaultCategory, onClose }: { filter: Record<string, string>; categories?: string[]; defaultCategory: string; onClose: () => void }) {
  const meta = useMeta();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(defaultCategory);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = (meta?.document_categories || []).filter((c) => !categories || categories.includes(c.value));
  const sensitive = ["KYC_AADHAAR", "KYC_OTHER", "BANK_PROOF"].includes(category);

  const upload = async () => {
    if (!files.length) {
      setError("Choose at least one file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const f of files) {
        const form = new FormData();
        form.set("category", category);
        if (title) form.set("title", files.length > 1 ? `${title} (${f.name})` : title);
        for (const [k, v] of Object.entries(filter)) form.set(k, v);
        form.set("file", f);
        await api("documents/", { form });
      }
      toast(files.length > 1 ? `${files.length} files uploaded` : "File uploaded");
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["farmer-history"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload document or photo"
      onClose={onClose}
      narrow
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={upload}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <label className="field">
          <span className="lbl">Document type</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {sensitive && <span className="hint">Stored encrypted. Only authorised roles can open it. Upload the masked Aadhaar where possible.</span>}
        </label>
        <label className="field">
          <span className="lbl">Title (optional)</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="drop">
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Choose files
          </button>
          <div style={{ marginTop: 8 }}>{files.length ? files.map((f) => f.name).join(", ") : "Photos (JPG, PNG) or PDF, up to 20 MB each"}</div>
        </div>
      </div>
    </Modal>
  );
}
