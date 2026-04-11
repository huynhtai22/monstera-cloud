export function timeDecayWeights(touchTimestamps: number[], orderTimestamp: number, halfLifeHours = 24): number[] {
  if (touchTimestamps.length === 0) return [];
  const halfLifeMs = halfLifeHours * 60 * 60 * 1000;
  const raw = touchTimestamps.map((t) => {
    const dt = Math.max(0, orderTimestamp - t);
    return Math.pow(0.5, dt / halfLifeMs);
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((w) => w / sum);
}

