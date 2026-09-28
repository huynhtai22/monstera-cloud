"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  PROVIDER_NAMES,
  formatCompactNumber,
  formatCurrency,
} from "@/components/dashboard/console-presentation";
import { Empty } from "./PreviewPrimitives";
import type { CampaignRow } from "./sections-model";
import styles from "./sections.module.css";

export function CampaignTable({
  rows,
  traffic = false,
}: {
  rows: CampaignRow[];
  traffic?: boolean;
}) {
  const [sort, setSort] = useState<{
    key: "date" | "name";
    ascending: boolean;
  }>({ key: "date", ascending: false });
  const sorted = [...rows].sort(
    (a, b) =>
      a[sort.key].localeCompare(b[sort.key]) * (sort.ascending ? 1 : -1),
  );
  function toggle(key: "date" | "name") {
    setSort((prev) => ({
      key,
      ascending: prev.key === key ? !prev.ascending : true,
    }));
  }
  if (!rows.length)
    return (
      <Empty title="No metrics in this view">
        Try another source or client, or import data to start exploring.
      </Empty>
    );
  return (
    <div
      className={styles.tableWrap}
      role="region"
      aria-label="Campaign metrics"
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th
              aria-sort={
                sort.key === "name"
                  ? sort.ascending
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button type="button" onClick={() => toggle("name")}>
                Campaign{" "}
                {sort.key === "name" &&
                  (sort.ascending ? (
                    <ArrowUp size={11} />
                  ) : (
                    <ArrowDown size={11} />
                  ))}
              </button>
            </th>
            <th>Platform</th>
            <th
              aria-sort={
                sort.key === "date"
                  ? sort.ascending
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button type="button" onClick={() => toggle("date")}>
                Date{" "}
                {sort.key === "date" &&
                  (sort.ascending ? (
                    <ArrowUp size={11} />
                  ) : (
                    <ArrowDown size={11} />
                  ))}
              </button>
            </th>
            <th>Currency</th>
            {traffic ? (
              <>
                <th className={styles.numeric}>Impressions</th>
                <th className={styles.numeric}>Clicks</th>
                <th className={styles.numeric}>CTR</th>
              </>
            ) : (
              <>
                <th className={styles.numeric}>Spend</th>
                <th className={styles.numeric}>Revenue</th>
                <th className={styles.numeric}>ROAS</th>
              </>
            )}
            <th className={styles.numeric}>Conversions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.name}</strong>
                <small>{row.client}</small>
              </td>
              <td>{PROVIDER_NAMES[row.platform] || row.platform}</td>
              <td>{row.date}</td>
              <td>{row.currency}</td>
              {traffic ? (
                <>
                  <td className={styles.numeric}>
                    {formatCompactNumber(row.impressions)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCompactNumber(row.clicks)}
                  </td>
                  <td className={styles.numeric}>
                    {((row.clicks / row.impressions) * 100).toFixed(2)}%
                  </td>
                </>
              ) : (
                <>
                  <td className={styles.numeric}>
                    {formatCurrency(row.spend, row.currency)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCurrency(row.revenue, row.currency)}
                  </td>
                  <td className={styles.numeric}>
                    {(row.revenue / row.spend).toFixed(2)}×
                  </td>
                </>
              )}
              <td className={styles.numeric}>
                {row.conversions.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
