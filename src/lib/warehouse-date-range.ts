/**
 * Single canonical date-only range validation and conversion for Warehouse.
 *
 * Enforces:
 *   - Strict calendar date validation (rejects invalid dates like 2026-02-30)
 *   - Strict format validation (rejects timestamps where date-only values are expected)
 *   - Timezone-independent UTC calendar boundaries
 *   - Half-open database intervals:
 *       User selection: 2026-05-01 through 2026-05-05
 *       Meta / provider request: since=2026-05-01, until=2026-05-05
 *       Database query: date >= 2026-05-01T00:00:00.000Z AND date < 2026-05-06T00:00:00.000Z
 */

export interface ParsedCalendarDate {
  year: number;
  month: number;
  day: number;
  isoDate: string; // YYYY-MM-DD
  utcMidnight: Date;
}

export interface CanonicalDateRange {
  since: string; // Inclusive date-only string for providers
  until: string; // Inclusive date-only string for providers
  startUtc: Date; // UTC midnight of start day
  endUtc: Date; // UTC midnight of end day
  endUtcExclusive: Date; // UTC midnight of the day following end day
  dbWhereDate: {
    gte: Date;
    lt: Date;
  };
}


const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

/**
 * Validates and parses a strict YYYY-MM-DD calendar date string.
 * Returns null if the string contains a timestamp, is malformed, or represents an impossible calendar date.
 */
export function parseStrictDateOnly(dateStr: string): ParsedCalendarDate | null {
  if (typeof dateStr !== "string" || !DATE_REGEX.test(dateStr)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (month < 1 || month > 12) return null;
  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) return null;

  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return {
    year,
    month,
    day,
    isoDate: `${yearStr}-${monthStr}-${dayStr}`,
    utcMidnight,
  };
}

/**
 * Resolves a date input (string or Date) to a ParsedCalendarDate.
 */
function resolveDateInput(input: string | Date, paramName: string): ParsedCalendarDate {
  if (typeof input === "string") {
    const parsed = parseStrictDateOnly(input);
    if (!parsed) {
      throw new Error(`Invalid calendar date for ${paramName}: "${input}". Expected strict YYYY-MM-DD.`);
    }
    return parsed;
  }
  if (input instanceof Date && !isNaN(input.getTime())) {
    const year = input.getUTCFullYear();
    const month = input.getUTCMonth() + 1;
    const day = input.getUTCDate();
    const yearStr = String(year).padStart(4, "0");
    const monthStr = String(month).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return {
      year,
      month,
      day,
      isoDate: `${yearStr}-${monthStr}-${dayStr}`,
      utcMidnight,
    };
  }
  throw new Error(`Invalid calendar date for ${paramName}. Expected strict YYYY-MM-DD string or valid Date.`);
}

/**
 * Constructs the canonical date range contract used across query, aggregate, and provider sync.
 *
 * For a user range of 1–5 May 2026:
 *   since: "2026-05-01"
 *   until: "2026-05-05"
 *   startUtc: 2026-05-01T00:00:00.000Z
 *   endUtcExclusive: 2026-05-06T00:00:00.000Z
 *   dbWhereDate: { gte: 2026-05-01T00:00:00.000Z, lt: 2026-05-06T00:00:00.000Z }
 */
export function getCanonicalDateRange(
  startDateInput: string | Date,
  endDateInput: string | Date
): CanonicalDateRange {
  const start = resolveDateInput(startDateInput, "startDate");
  const end = resolveDateInput(endDateInput, "endDate");

  if (end.utcMidnight.getTime() < start.utcMidnight.getTime()) {
    throw new Error(
      `startDate must be before or equal to endDate (received startDate=${start.isoDate}, endDate=${end.isoDate})`
    );
  }

  const endUtcExclusive = new Date(end.utcMidnight.getTime() + 24 * 60 * 60 * 1000);

  return {
    since: start.isoDate,
    until: end.isoDate,
    startUtc: start.utcMidnight,
    endUtc: end.utcMidnight,
    endUtcExclusive,
    dbWhereDate: {
      gte: start.utcMidnight,
      lt: endUtcExclusive,
    },
  };

}
