/**
 * Shared export utilities for CSV and Excel downloads.
 * Used by TikTok Ads, Shopee, and any future data pages.
 */

import * as XLSX from "@e965/xlsx";

/** Trigger a browser CSV file download. */
export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h] ?? "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger a browser Excel (.xlsx) file download with auto-fitted column widths. */
export function downloadExcel(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-fit column widths based on header + content length
  const headers = Object.keys(rows[0]);
  ws["!cols"] = headers.map((key) => ({
    wch:
      Math.max(key.length, ...rows.map((r) => String(r[key] ?? "").length)) +
      2,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** Trigger a browser Excel (.xlsx) download with multiple named sheets. */
export function downloadMultiSheetExcel(
  sheets: Array<{ name: string; rows: Record<string, unknown>[] }>,
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    if (s.rows.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(s.rows);
    const headers = Object.keys(s.rows[0]);
    ws["!cols"] = headers.map((key) => ({
      wch: Math.max(key.length, ...s.rows.map((r) => String(r[key] ?? "").length)) + 2,
    }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); // Excel limits sheet name to 31 chars
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

