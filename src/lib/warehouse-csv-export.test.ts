import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { warehouseAdsCsvRows, warehouseRetailOrdersCsvRows } from "./warehouse-csv-export";

describe("warehouse CSV delivery", () => {
  it("includes currency alongside persisted ad monetary values", () => {
    const rows = warehouseAdsCsvRows([{ date: new Date("2026-08-20T00:00:00Z"), campaignName: "Launch", impressions: 10, clicks: 2, spend: 12, cpc: 6, ctr: 0.2, conversions: 1, revenue: 36, roas: 3, currency: "USD" }]);
    assert.equal(rows[0].at(-1), "Currency");
    assert.equal(rows[1].at(-1), "USD");
    assert.equal(rows[1][8], 36);
  });

  it("exports persisted retail orders with their currency", () => {
    const rows = warehouseRetailOrdersCsvRows([{ orderId: "order-1", platform: "shopee", grossRevenue: 35000000, netRevenue: null, currency: "VND", createdAtIso: "2026-08-20T00:00:00.000Z" }]);
    assert.deepEqual(rows[0], ["Order ID", "Platform", "Gross Revenue", "Net Revenue", "Currency", "Created At"]);
    assert.equal(rows[1][4], "VND");
  });
});
