import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { api, ApiError, downloadFile } from "../api";
import { Loading, PageHead, Panel } from "../components/ui";
import { useProject, useToast } from "../state";

const DESCRIPTIONS: Record<string, string> = {
  farmers: "Farmer ID, relation, village, KYC status, survey numbers and projects.",
  progress: "Every pole, tower and site with GPS coordinates, farmers and the date each stage was completed.",
  compensation: "Approved, paid and balance per compensation record, with totals.",
  payments: "All recorded payments with mode, UTR / cheque number and who recorded them.",
  agreements: "Executed and pending agreements with consideration, stamp duty and registration.",
  crop: "Crop assessments with revenue and company figures.",
  villages: "Farmers, survey numbers, locations, ROW cleared and money by taluk, hobli and village.",
};

export default function Reports() {
  const { projectId, current } = useProject();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: () => api<{ key: string; title: string }[]>("reports/") });
  const run = async (key: string) => {
    setBusy(key);
    try {
      await downloadFile(`reports/${key}/${projectId ? `?project=${projectId}` : ""}`, `${key}.xlsx`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageHead title="Reports" sub={`Excel downloads for ${current ? current.code : "all your projects"}. Change the project at the top of the page to narrow them.`} />
      <Panel pad={false}>
        {isLoading ? (
          <Loading />
        ) : (
          <table className="data">
            <tbody>
              {data?.map((r) => (
                <tr key={r.key}>
                  <td style={{ width: "36%" }}>
                    <strong>{r.title}</strong>
                  </td>
                  <td className="muted">{DESCRIPTIONS[r.key]}</td>
                  <td className="right">
                    <button className="btn btn-small" disabled={busy === r.key} onClick={() => run(r.key)}>
                      <FileSpreadsheet /> {busy === r.key ? "Preparing…" : "Download Excel"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="muted small" style={{ marginTop: 12 }}>
        A farmer-wise complete statement is available from each farmer's page. A KML file of locations can be exported from Poles & towers.
      </p>
    </>
  );
}
