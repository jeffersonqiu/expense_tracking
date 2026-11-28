import { money } from "@/lib/format";
import type { TripTotals } from "@/lib/server/trips";

/** Daily / Transport / Hotels split by who paid: you (personal) vs the company (business, claimable). */
export function BucketTable({ tt, base, showBusiness }: { tt: TripTotals; base: string; showBusiness: boolean }) {
  const rows = [
    ["Daily", tt.personal.daily, tt.business.daily],
    ["Transport", tt.personal.transport, tt.business.transport],
    ["Hotels", tt.personal.hotels, tt.business.hotels],
    ...(tt.unsplit ? [["Not split", tt.unsplit, 0] as const] : []),
  ] as const;
  return (
    <div className="list">
      <table className="buckets num">
        <thead>
          <tr><th /><th>Personal</th>{showBusiness && <th>Business</th>}</tr>
        </thead>
        <tbody>
          {rows.map(([k, p, b]) => (
            <tr key={k}><th>{k}</th><td>{money(p, base)}</td>{showBusiness && <td>{money(b, base)}</td>}</tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th>Total</th><td>{money(tt.personal.total, base)}</td>{showBusiness && <td>{money(tt.business.total, base)}</td>}</tr>
        </tfoot>
      </table>
    </div>
  );
}
