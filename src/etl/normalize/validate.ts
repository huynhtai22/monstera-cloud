import { z } from 'zod';

export function validateMany<T>(
  schema: z.ZodSchema<T>,
  rows: unknown[],
): { ok: T[]; errors: { index: number; message: string }[] } {
  const ok: T[] = [];
  const errors: { index: number; message: string }[] = [];

  rows.forEach((r, index) => {
    const parsed = schema.safeParse(r);
    if (parsed.success) ok.push(parsed.data);
    else errors.push({ index, message: parsed.error.issues.map((i) => i.message).join('; ') });
  });

  return { ok, errors };
}

