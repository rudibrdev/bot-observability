import { getDb } from "@/app/dashboard/db";
import { Panel } from "@/app/dashboard/shared";

export async function IngestionAudit({ from, to, project }: { from: Date; to: Date; project?: string }) {
  const rows = await getDb().dailyRejections(from, to, project);
  return <Panel title="Ingestion refusals" eyebrow="per UTC day">
    <p className="evidence-caption">Authenticated deliveries refused by the collector, not estimated visits. Whole UTC days overlapping the selected period; today is partial. Project filter only; bot/category/status filters do not apply. Records follow raw-event retention. Counts begin when migration 009 is installed; earlier refusals cannot be recovered. Requests that never reach the collector are not measured here.</p>
    {rows.length ? <div className="responsive-data-table"><table className="data-table w-full">
      <thead><tr><th className="text-left">UTC day</th><th className="text-left">Reason</th><th className="text-right">Refusals</th></tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.day}:${row.reason}`}><td data-label="UTC day">{row.day}</td><td data-label="Reason">{row.reason}</td><td data-label="Refusals" className="text-right font-mono">{row.count.toLocaleString()}</td></tr>)}</tbody>
    </table></div> : <p>No recorded refusals in the retained days of this period. This does not prove complete website coverage.</p>}
  </Panel>;
}
