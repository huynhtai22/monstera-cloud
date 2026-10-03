/** Counts refer to completed import items, never an estimated percentage or time. */
export function importItemProgress(completed: number | null, total: number | null) {
  if (completed === null || total === null || !Number.isInteger(completed) || !Number.isInteger(total) || total <= 0 || completed < 0 || completed > total) return null;
  return { completed, total };
}

