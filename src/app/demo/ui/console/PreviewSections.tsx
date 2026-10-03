"use client";
import { OperationsPreview } from "./OperationsPreview";
import { SourcesPreview } from "./SourcesPreview";
import { ReportsPreview } from "./ReportsPreview";
import { WarehousePreview } from "./WarehousePreview";
import { ExportsPreview } from "./ExportsPreview";
import { ClientsPreview } from "./ClientsPreview";
import { SettingsPreview } from "./SettingsPreview";
import type { SectionProps } from "./section-types";
import type { SectionId } from "./sections-model";

export function PreviewSections({
  section,
  ...props
}: SectionProps & { section: Exclude<SectionId, "dashboard"> }) {
  const Component = {
    operations: OperationsPreview,
    sources: SourcesPreview,
    reports: ReportsPreview,
    warehouse: WarehousePreview,
    exports: ExportsPreview,
    clients: ClientsPreview,
    settings: SettingsPreview,
  }[section];
  return <Component key={`${section}-${props.mode}`} {...props} />;
}
