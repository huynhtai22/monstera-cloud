export type SecurityPostureInput = {
  now: Date;
  authFailures15m: number;
  pinRejections15m: number;
  cronFailures30m: number;
  lastRetentionSuccessAt: Date | null;
  thresholds?: {
    authFailures15m?: number;
    pinRejections15m?: number;
    maxRetentionAgeHours?: number;
  };
};

export type SecurityPostureBreach = {
  code: "AUTH_FAILURE_SPIKE" | "API_KEY_PIN_REJECTION_SPIKE" | "CRON_FAILURE" | "RETENTION_LAG";
  actual: number | null;
  threshold: number;
};

export function evaluateSecurityPosture(input: SecurityPostureInput): SecurityPostureBreach[] {
  const authThreshold = input.thresholds?.authFailures15m ?? 20;
  const pinThreshold = input.thresholds?.pinRejections15m ?? 5;
  const retentionHours = input.thresholds?.maxRetentionAgeHours ?? 26;
  const breaches: SecurityPostureBreach[] = [];
  if (input.authFailures15m >= authThreshold) {
    breaches.push({ code: "AUTH_FAILURE_SPIKE", actual: input.authFailures15m, threshold: authThreshold });
  }
  if (input.pinRejections15m >= pinThreshold) {
    breaches.push({ code: "API_KEY_PIN_REJECTION_SPIKE", actual: input.pinRejections15m, threshold: pinThreshold });
  }
  if (input.cronFailures30m > 0) {
    breaches.push({ code: "CRON_FAILURE", actual: input.cronFailures30m, threshold: 0 });
  }
  const retentionAgeHours = input.lastRetentionSuccessAt
    ? (input.now.getTime() - input.lastRetentionSuccessAt.getTime()) / (60 * 60 * 1000)
    : null;
  if (retentionAgeHours == null || retentionAgeHours > retentionHours) {
    breaches.push({ code: "RETENTION_LAG", actual: retentionAgeHours, threshold: retentionHours });
  }
  return breaches;
}
