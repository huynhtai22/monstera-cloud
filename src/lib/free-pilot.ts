export const FREE_PILOT_DAYS = 7;

export function freePilotEndsAt(from = new Date()): Date {
  return new Date(from.getTime() + FREE_PILOT_DAYS * 86_400_000);
}
