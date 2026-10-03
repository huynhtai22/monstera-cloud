import type { BlueprintReport } from "@/lib/report-blueprint";

export type RenderedApprovedReportEmail = {
  subject: string;
  html: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Not available"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  if (!currency) return `${formatCount(value)} (currency unverified)`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "VND" ? 0 : 2,
    }).format(value);
  } catch {
    return `${formatCount(value)} ${currency}`;
  }
}

/** Render only the immutable Blueprint result; callers must authorize and revalidate it. */
export function renderApprovedReportEmail(report: BlueprintReport): RenderedApprovedReportEmail {
  const clientName = report.overview.clientName || "Client";
  const window = report.overview.reportingWindow;
  const totals = report.totals;
  const aggregateAvailable = !totals.unavailable && totals.scope !== "unavailable";
  const subjectClient = clientName.replace(/[\r\n]+/g, " ").slice(0, 100);
  const campaignRows = report.campaigns.slice(0, 50).map((campaign) => `
    <tr>
      <td>${escapeHtml(campaign.providerLabel)}</td>
      <td>${escapeHtml(campaign.campaignName)}</td>
      <td style="text-align:right">${escapeHtml(formatMoney(campaign.spend, campaign.currency))}</td>
      <td style="text-align:right">${escapeHtml(formatCount(campaign.clicks))}</td>
      <td style="text-align:right">${escapeHtml(formatCount(campaign.conversions))}</td>
    </tr>`).join("");
  const campaignNote = report.campaigns.length > 50 || report.campaignTruncated
    ? `<p style="font-size:12px;color:#64748b">Showing 50 campaigns from the approved snapshot.</p>`
    : "";

  return {
    subject: `Approved weekly report: ${subjectClient} (${window.start} to ${window.end})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#0f172a;line-height:1.5">
        <h1 style="font-size:22px">Weekly paid media report</h1>
        <p><strong>${escapeHtml(clientName)}</strong> · ${escapeHtml(window.start)} to ${escapeHtml(window.end)}</p>
        <p style="font-size:12px;color:#475569">Approved snapshot generated ${escapeHtml(report.overview.generatedAt)}. Values below are taken from that snapshot.</p>
        <h2 style="font-size:16px">Overview</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse">
          <tbody>
            <tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">Spend</td><td style="padding:6px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(formatMoney(aggregateAvailable ? totals.spend : null, totals.currency))}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">Impressions</td><td style="padding:6px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(formatCount(aggregateAvailable ? totals.impressions : null))}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">Clicks</td><td style="padding:6px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(formatCount(aggregateAvailable ? totals.clicks : null))}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">Conversions</td><td style="padding:6px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(formatCount(aggregateAvailable ? totals.conversions : null))}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">Conversion value</td><td style="padding:6px;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(formatMoney(aggregateAvailable ? totals.conversionValue : null, totals.currency))}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">ROAS</td><td style="padding:6px;text-align:right;border-bottom:1px solid #e2e8f0">${!aggregateAvailable || totals.roas === null ? "Not available" : `${escapeHtml(formatCount(totals.roas))}x`}</td></tr>
          </tbody>
        </table>
        <h2 style="font-size:16px;margin-top:24px">Campaigns</h2>
        ${report.campaigns.length === 0 ? "<p>No campaign-level rows were included in this snapshot.</p>" : `
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid #cbd5e1">Provider</th><th style="text-align:left;padding:6px;border-bottom:1px solid #cbd5e1">Campaign</th><th style="text-align:right;padding:6px;border-bottom:1px solid #cbd5e1">Spend</th><th style="text-align:right;padding:6px;border-bottom:1px solid #cbd5e1">Clicks</th><th style="text-align:right;padding:6px;border-bottom:1px solid #cbd5e1">Conversions</th></tr></thead>
            <tbody>${campaignRows}</tbody>
          </table>${campaignNote}`}
        <p style="font-size:11px;color:#64748b;margin-top:24px">The email provider accepted this message for processing. This status does not confirm inbox delivery.</p>
      </div>
    `,
  };
}
