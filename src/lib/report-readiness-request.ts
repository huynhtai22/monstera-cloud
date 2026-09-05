import { z } from "zod";
import { defaultReportingWindow } from "./report-readiness";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s;
}, "Invalid calendar date");
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
export const readinessRequestSchema = z.object({
  workspaceId: id, clientId: id.optional(), start: date.optional(), end: date.optional(),
  after: id.optional(), limit: z.coerce.number().int().min(1).max(50).default(50),
}).strict().superRefine((value,ctx) => {
  if (Boolean(value.start) !== Boolean(value.end)) ctx.addIssue({ code: "custom", message: "Provide both start and end" });
  if (value.start && value.end) {
    const days = (Date.parse(value.end) - Date.parse(value.start)) / 86400000 + 1;
    if (days < 1 || days > 90) ctx.addIssue({ code: "custom", message: "Window must be 1–90 days" });
    if (value.end > new Date().toISOString().slice(0,10)) ctx.addIssue({ code: "custom", message: "Future dates are not supported" });
  }
  if (value.clientId && value.after) ctx.addIssue({ code: "custom", message: "Single-client evaluation cannot be paginated" });
});
export function parseReadinessRequest(value: unknown) {
  const parsed = readinessRequestSchema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  return { ...data, window: data.start && data.end ? { start: data.start, end: data.end } : defaultReportingWindow() };
}
