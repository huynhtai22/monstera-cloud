import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";
import type { PreviewState } from "./fixtures";
export type SectionProps = {
  overview: DashboardOverviewDTO;
  mode: PreviewState;
};
