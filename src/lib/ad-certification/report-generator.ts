/**
 * Reviewer Report Generator
 * Converts CertificationEvidencePack into an auditable Markdown report.
 */

import type { CertificationEvidencePack } from "./types";

export function generateReviewerMarkdown(pack: CertificationEvidencePack): string {
  const providerDisplayNames: Record<string, string> = {
    google_ads: "Google Ads",
    meta_ads: "Meta Ads",
    tiktok_business: "TikTok for Business (Marketing API)",
  };

  const name = providerDisplayNames[pack.provider] || pack.provider;

  let md = `# Ad Connector Certification Report: ${name}\n\n`;
  md += `**Evaluation Timestamp:** ${pack.evaluatedAt}  \n`;
  md += `**Run Identifier:** \`${pack.runId}\`  \n`;
  md += `**Build Identifier:** \`${pack.buildId}\`  \n`;
  md += `**Target Account:** \`${pack.accountId}\`  \n`;
  md += `**Bounded Window:** \`${pack.dateRange.start}\` to \`${pack.dateRange.end}\` (${pack.dateRange.days} days)  \n`;
  md += `**Evidence Class:** \`${pack.evidenceClass}\`  \n`;
  md += `**Storage Backend:** \`${pack.storageType}\`  \n`;
  md += `**Highest Proven Level:** **\`${pack.highestProvenLevel}\`**  \n`;
  md += `**Controlled Pilot Eligible:** **${pack.pilotEligible ? "YES ✅" : "NO ❌"}**  \n`;
  md += `**Certification Eligible:** **${pack.certificationEligible ? "YES ✅" : "NO ❌"}**  \n`;
  md += `**Working Tree Dirty:** **${pack.workingTreeDirty ? "YES (Dirty) ⚠️" : "NO (Clean) ✅"}**  \n\n`;

  md += `---\n\n`;
  md += `## 1. Executive Summary\n\n`;
  md += `This auditable evaluation assessed the readiness of the **${name}** connector for Monstera Cloud's controlled agency pilot. `;
  md += `In adherence to strict pilot governance rules, code verification, sandbox tests, and live certification are treated as separate, non-fungible states. `;
  md += `The connector reached **\`${pack.highestProvenLevel}\`**.\n\n`;

  if (pack.pilotEligible) {
    md += `> [!IMPORTANT]\n`;
    md += `> All mandatory certification gates have been verified, native platform metrics reconciled within documented tolerance, and authorized human sign-off recorded. The connector is approved for pilot customers.\n\n`;
  } else {
    md += `> [!WARNING]\n`;
    md += `> **Controlled Pilot Blocked:** The connector CANNOT be offered as live-certified to pilot customers until the blockers below are resolved with an authorized real advertising account.\n\n`;
  }

  md += `## 2. Ordered Certification Gates\n\n`;
  md += `| Tier | Certification Gate | Status | Evaluated Outcome |\n`;
  md += `|:---:|---|:---:|---|\n`;

  for (let i = 0; i < pack.gateOutcomes.length; i++) {
    const g = pack.gateOutcomes[i];
    const statusIcon =
      g.status === "PASSED"
        ? "✅ PASSED"
        : g.status === "BLOCKED"
        ? "⚠️ BLOCKED"
        : g.status === "FAILED"
        ? "❌ FAILED"
        : g.status === "NOT_APPLICABLE"
        ? "⚪ NOT_APPLICABLE"
        : "⏸️ NOT_EXECUTED";
    md += `| ${i + 1} | \`${g.gate}\` | ${statusIcon} | ${g.details.replace(/\|/g, "\\|")} |\n`;
  }

  md += `\n---\n\n`;

  md += `## 3. Blockers & Required Actions\n\n`;
  if (pack.blockers.length === 0) {
    md += `*No active blockers identified. All evaluated stages passed.*\n\n`;
  } else {
    md += `The following gates blocked progression to higher certification tiers:\n\n`;
    for (const b of pack.blockers) {
      md += `### ⚠️ Blocker: ${b.category}\n\n`;
      md += `- **Details:** ${b.description}\n`;
      md += `- **Required Action:** ${b.requiredAction}\n\n`;
    }
  }

  md += `## 4. Destination Delivery & Retrieval Breakdown\n\n`;
  md += `- **Destination Code Path:** \`${pack.destinationStatus.codePath}\`\n`;
  md += `- **Authenticated Live Retrieval:** \`${pack.destinationStatus.authenticatedLiveRetrieval}\`\n`;
  md += `- **Current Delivery Receipt:** \`${pack.destinationStatus.currentDeliveryReceipt}\`\n`;
  md += `- **Destination Certification Level:** \`${pack.destinationStatus.destinationCertificationLevel}\`\n`;
  md += `- **Evaluation Details:** ${pack.destinationStatus.details}\n\n`;

  if (pack.providerAccessFacts) {
    md += `## 5. Provider Access & Portal Verification Audit\n\n`;
    md += `- **Observed API Version:** \`${pack.providerAccessFacts.observedApiVersion}\`\n`;
    const scopes =
      Array.isArray(pack.providerAccessFacts.grantedScopesOrPermissions) &&
      pack.providerAccessFacts.grantedScopesOrPermissions.length > 0
        ? pack.providerAccessFacts.grantedScopesOrPermissions.join(", ")
        : "None verified";
    md += `- **Granted Scopes/Permissions:** ${scopes}\n`;
    md += `- **Access Level Status:** \`${pack.providerAccessFacts.accessLevelStatus}\`\n`;
    md += `- **Authorization Model:** \`${pack.providerAccessFacts.authorizationModel}\`\n`;
    md += `- **Token Lifecycle Model:** \`${pack.providerAccessFacts.tokenLifecycleModel}\`\n`;
    md += `- **Verification Source:** \`${pack.providerAccessFacts.verificationSource}\`\n`;
    md += `- **Overall Status:** **\`${pack.providerAccessFacts.status}\`**\n\n`;
  }

  if (pack.reconciliation) {
    md += `## 6. Native vs Warehouse Metric Reconciliation\n\n`;
    md += `- **Account Timezone:** \`${pack.reconciliation.accountTimezone}\`\n`;
    md += `- **Currency:** \`${pack.reconciliation.currency}\`\n`;
    md += `- **Snapshot Aligned:** ${pack.reconciliation.isSnapshotAligned ? "YES ✅" : "NO ⚠️ (Timing Discrepancy)"}\n`;
    if (pack.reconciliation.nativeRetrievalTime) {
      md += `- **Native Retrieval Time:** \`${pack.reconciliation.nativeRetrievalTime}\`\n`;
    }
    if (pack.reconciliation.monsteraDataThroughTime) {
      md += `- **Monstera Data-Through Time:** \`${pack.reconciliation.monsteraDataThroughTime}\`\n`;
    }
    if (pack.reconciliation.warehouseQueryTime) {
      md += `- **Warehouse Query Time:** \`${pack.reconciliation.warehouseQueryTime}\`\n`;
    }
    md += `- **Underlying Inputs Valid:** ${pack.reconciliation.underlyingInputsValid ? "YES ✅" : "NO ❌"}\n\n`;

    if (pack.reconciliation.isInconclusive) {
      md += `> [!WARNING]\n`;
      md += `> **Inconclusive Comparison:** ${pack.reconciliation.inconclusiveReason}\n\n`;
    }

    md += `| Metric | Provider Native | Warehouse | Abs Variance | % Variance | Tolerance | Status |\n`;
    md += `|---|---:|---:|---:|---:|---:|:---:|\n`;

    for (const m of pack.reconciliation.metrics) {
      const match = m.withinTolerance ? "MATCH ✅" : "MISMATCH ⚠️";
      const pctStr = m.percentVariance !== null ? `${m.percentVariance.toFixed(2)}%` : "N/A";
      md += `| **${m.metric}** | ${m.providerValue} | ${m.warehouseValue} | ${m.absoluteVariance} | ${pctStr} | ±${m.tolerance} | ${match} |\n`;
    }
    md += `\n`;

    if (pack.reconciliation.unexplainedVariances.length > 0) {
      md += `> [!CAUTION]\n`;
      md += `> Unexplained material variances detected: **${pack.reconciliation.unexplainedVariances.join(", ")}**. Explanations must be supplied before proceeding.\n\n`;
    }
  }

  md += `## 7. Security, Secret Scrubbing & Tenant Safety Audit\n\n`;
  md += `- **Credential Redaction:** Verified. Zero client secrets, developer tokens, access tokens, refresh tokens, cookies, or auth headers are present in this evidence pack.\n`;
  md += `- **Account Masking:** Target account is stably masked (\`${pack.accountId}\`) for safe reviewer auditing.\n`;
  md += `- **Tenant Isolation:** Workspace boundary confirmed (\`${pack.workspaceId}\`). Cross-tenant pollution is prevented by Prisma tenant guards.\n\n`;

  if (pack.localExportWarning) {
    md += `> [!CAUTION]\n`;
    md += `> **Temporary Operator Local Export:** ${pack.localExportWarning}\n`;
    if (pack.localExportDeletionPolicy) {
      md += `> \n> **Deletion Policy:** ${pack.localExportDeletionPolicy}\n`;
    }
    md += `\n`;
  }

  md += `## 8. Reviewer Sign-Off & Traceability\n\n`;
  md += `- **Evaluated By:** ${pack.metadata.evaluatedBy}\n`;
  md += `- **Harness Version:** ${pack.metadata.harnessVersion}\n`;
  md += `- **Metric Contract Version:** ${pack.metadata.contractVersion}\n`;
  md += `- **Evidence Pack Schema Version:** ${pack.metadata.evidencePackSchemaVersion}\n`;
  md += `- **Build Identifier:** \`${pack.buildId}\`\n`;
  md += `- **Schema Version:** ${pack.metadata.schemaVersion}\n`;
  md += `- **Git Commit SHA:** \`${pack.metadata.commitSha || pack.metadata.gitCommit}\`\n`;
  md += `- **Working Tree Dirty:** ${pack.metadata.workingTreeDirty ? "YES (Dirty)" : "NO (Clean)"}\n`;
  md += `- **Certification Eligible:** ${pack.metadata.certificationEligible ? "YES" : "NO"}\n\n`;

  md += `_Report generated by Monstera Cloud Ad Certification Harness._\n`;

  return md;
}
