import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseTripRows } from "../src/lib/server/trips";

describe("trip import", () => {
  it("reads rows copied straight from the Travel Collation sheet", () => {
    const pasted = [
      "No.\tMonth Year\tYear\tTravel\tDaily Spending\tTravel\tAccom\tTotal\tLinks",
      "0\tJan 2025\t2025\tNew Year 2025\t$1,044.75\t$309.87\t$0.00\t$1,354.62\t[Spending Tracker] New Year 2025\tLink",
      "2\tApr 2025\t2025\tUS 2025\t$0.00\t$0.00\t$0.00\t$18,604.10\tUS April - May 2025\tLink",
      "11\tJul 2026\t2026\tAU 2026\t$3,092.00\tSGD0\tSGD0\t$3,092.00\t[Spending Tracker] AU 2026\tLink",
      "15\tDec 2026\t2026\tItaly",
    ].join("\n");
    const rows = parseTripRows(pasted);
    expect(rows.map((r) => r.name)).toEqual(["New Year 2025", "US 2025", "AU 2026", "Italy"]);
    expect(rows[0]).toMatchObject({ start: "2025-01-01", daily: 1044.75, transport: 309.87, hotels: 0, unsplit: 0 });
    expect(rows[1]).toMatchObject({ start: "2025-04-01", daily: 0, unsplit: 18604.1 });
    expect(rows[2]).toMatchObject({ daily: 3092, transport: 0, hotels: 0 });
    expect(rows[3]).toMatchObject({ start: "2026-12-01", daily: 0, transport: 0, hotels: 0, unsplit: 0 });
  });

  it("reads the prepared file with links", () => {
    const rows = parseTripRows("Oct 2026\tAgentix Bangkok\t45.00\t0.00\t0.00\t45.00\thttps://docs.google.com/spreadsheets/d/abc/edit");
    expect(rows[0]).toMatchObject({ name: "Agentix Bangkok", start: "2026-10-01", daily: 45, links: "https://docs.google.com/spreadsheets/d/abc/edit" });
  });
});
