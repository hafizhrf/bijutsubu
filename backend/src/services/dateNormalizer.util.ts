/**
 * Deterministic date detection + coercion for uploaded rows. Parsers hand us
 * date-looking values as plain strings ("7/4/2015", "2015-07-04"), and the
 * extraction-planner LLM often types those fields "string". This module is the
 * safety net: it scans each column's actual values, upgrades the field type to
 * "date" when every non-empty value parses under one consistent format, and
 * converts the values to real Date objects so Mongo stores BSON dates (which
 * sort/filter correctly in the dashboard pipeline).
 */

type FieldTypeName = "string" | "number" | "boolean" | "date" | "array" | "object";

interface FieldDescriptor {
  name: string;
  type: FieldTypeName;
  nullable: boolean;
}

/** Component order of a slash/dash/dot-separated date column. */
type DateFormat = "iso" | "mdy" | "dmy" | "ymd";

// 2015-07-04, optionally with time ("T" or space) and zone.
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
// 7/4/2015, 04-07-2015, 7.4.2015 — optionally followed by H:mm(:ss).
const DMY_MDY_RE =
  /^(\d{1,2})([/\-.])(\d{1,2})\2(\d{4})( (\d{1,2}):(\d{2})(:(\d{2}))?)?$/;
// 2015/7/4 (the dash form is already covered by ISO_RE when zero-padded).
const YMD_RE = /^(\d{4})([/\-.])(\d{1,2})\2(\d{1,2})( (\d{1,2}):(\d{2})(:(\d{2}))?)?$/;

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Decides whether a column of values is a date column, and in which format.
 * Strict on purpose: every non-empty value must parse — a mixed column stays
 * a string column rather than ending up half Date / half string.
 */
export function detectColumnDateFormat(values: unknown[]): DateFormat | null {
  const present = values.filter((v) => !isEmpty(v));
  if (present.length === 0) return null;

  // Excel (cellDates) already yields Date instances — nothing to detect, but
  // strings mixed in must still parse, so fall through with the string subset.
  const strings = present.filter((v) => !(v instanceof Date));
  if (strings.length === 0) return "iso";
  if (!strings.every((v) => typeof v === "string")) return null;

  const texts = strings as string[];
  if (texts.every((t) => ISO_RE.test(t) && componentsValid(...isoYmd(t)))) return "iso";
  if (texts.every((t) => YMD_RE.test(t))) {
    return texts.every((t) => {
      const m = YMD_RE.exec(t)!;
      return componentsValid(Number(m[1]), Number(m[3]), Number(m[4]));
    })
      ? "ymd"
      : null;
  }

  if (!texts.every((t) => DMY_MDY_RE.test(t))) return null;
  // Ambiguous 2-digit/2-digit order: any first component >12 forces day-first,
  // any second component >12 forces month-first. No evidence → month-first
  // (matches JS Date and the most common export format).
  let sawDayFirst = false;
  let sawMonthFirst = false;
  for (const t of texts) {
    const m = DMY_MDY_RE.exec(t)!;
    const a = Number(m[1]);
    const b = Number(m[3]);
    if (a > 12) sawDayFirst = true;
    if (b > 12) sawMonthFirst = true;
  }
  if (sawDayFirst && sawMonthFirst) return null;
  const format: DateFormat = sawDayFirst ? "dmy" : "mdy";
  const allValid = texts.every((t) => {
    const m = DMY_MDY_RE.exec(t)!;
    const [month, day] =
      format === "mdy" ? [Number(m[1]), Number(m[3])] : [Number(m[3]), Number(m[1])];
    return componentsValid(Number(m[4]), month, day);
  });
  return allValid ? format : null;
}

function isoYmd(text: string): [number, number, number] {
  const m = ISO_RE.exec(text)!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Real calendar check (rejects 2015-02-30) via UTC round-trip. */
function componentsValid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Parses one value under a detected format. Dates are built at UTC so the
 * server's local timezone can never shift "7/4/2015" onto a different day.
 * Returns null when the value doesn't conform (caller keeps the original).
 */
export function parseDateValue(value: unknown, format: DateFormat): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;

  if (format === "iso") {
    const m = ISO_RE.exec(value);
    if (!m) return null;
    // With an explicit zone the string is unambiguous — let JS parse it.
    if (m[10]) return new Date(value.replace(" ", "T"));
    return utcDate(Number(m[1]), Number(m[2]), Number(m[3]), m[5], m[6], m[8]);
  }
  if (format === "ymd") {
    const m = YMD_RE.exec(value);
    if (!m) return null;
    return utcDate(Number(m[1]), Number(m[3]), Number(m[4]), m[6], m[7], m[9]);
  }
  const m = DMY_MDY_RE.exec(value);
  if (!m) return null;
  const [month, day] =
    format === "mdy" ? [Number(m[1]), Number(m[3])] : [Number(m[3]), Number(m[1])];
  return utcDate(Number(m[4]), month, day, m[6], m[7], m[9]);
}

function utcDate(
  year: number,
  month: number,
  day: number,
  hh?: string,
  mm?: string,
  ss?: string,
): Date | null {
  if (!componentsValid(year, month, day)) return null;
  return new Date(
    Date.UTC(year, month - 1, day, Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0)),
  );
}

/**
 * Best-effort single-value parse for manual row edits on a field already typed
 * "date" (no column context, so ambiguous d/m vs m/d falls back to month-first,
 * matching detectColumnDateFormat's no-evidence default).
 */
export function coerceValueToDate(value: unknown): Date | null {
  for (const format of ["iso", "ymd", "mdy"] as const) {
    const parsed = parseDateValue(value, format);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Detects date columns in `rows`, converts their values to Date in place, and
 * returns the field list with those descriptors upgraded to type "date".
 *
 * - `existingFieldTypes`: types already recorded on the target collection's
 *   meta. A field the user/earlier uploads established as non-date is left
 *   untouched (coercing only new rows would mix strings and dates in one
 *   column); a field already typed "date" gets incoming strings coerced.
 * - `excludeFields`: fields that must keep primitive values (the merge/replace
 *   unique key — dedupe compares by value identity).
 */
export function normalizeDateFields(
  rows: Record<string, unknown>[],
  fields: FieldDescriptor[],
  existingFieldTypes: Map<string, string>,
  excludeFields: Set<string> = new Set(),
): FieldDescriptor[] {
  if (rows.length === 0) return fields;

  return fields.map((field) => {
    if (excludeFields.has(field.name)) return field;
    if (field.type !== "string" && field.type !== "date") return field;

    const existingType = existingFieldTypes.get(field.name);
    if (existingType !== undefined && existingType !== "date") return field;

    const format = detectColumnDateFormat(rows.map((row) => row[field.name]));
    if (!format) return field;

    for (const row of rows) {
      const value = row[field.name];
      if (isEmpty(value) || value instanceof Date) continue;
      const parsed = parseDateValue(value, format);
      if (parsed) row[field.name] = parsed;
    }
    return field.type === "date" ? field : { ...field, type: "date" as const };
  });
}
