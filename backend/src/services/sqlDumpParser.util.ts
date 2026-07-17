/**
 * Deterministic SQL-dump reader: extracts per-table column types from
 * CREATE TABLE statements and data rows from INSERT ... VALUES statements.
 * No LLM involvement — SQL dumps carry an explicit schema, so the upload
 * pipeline can import every table exactly instead of asking the planner to
 * guess from truncated raw text.
 *
 * Not a general SQL parser. Scope: the shape of mysqldump/pg_dump-style
 * exports. Views, triggers, procedures (DELIMITER blocks), INSERT...SELECT,
 * and generated columns are ignored on purpose.
 */

export type SqlFieldType = "string" | "number" | "boolean" | "date";

export interface SqlDumpTable {
  /** Table name exactly as written (unquoted). */
  name: string;
  /** Field name/type pairs for every column that appears in the data rows. */
  fields: { name: string; type: SqlFieldType }[];
  rows: Record<string, unknown>[];
  /** Primary-key column (declared or synthesized) when present in the rows. */
  pk: string | null;
}

/** A FOREIGN KEY constraint: fromTable.fromField references toTable.toField. */
export interface SqlDumpRelation {
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
}

export interface SqlDumpResult {
  tables: SqlDumpTable[];
  /** Only relations whose both endpoints are tables with data rows. */
  relations: SqlDumpRelation[];
}

const NUMBER_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|serial|bigserial|money)/i;
const DATE_TYPES = /^(date|datetime|timestamp|timestamptz|time)/i;
const BOOL_TYPES = /^(bool|boolean)/i;

const CONSTRAINT_KEYWORDS = new Set([
  "primary", "unique", "key", "constraint", "foreign", "index", "check", "fulltext", "spatial", "exclude",
]);

function mapSqlType(rawType: string): SqlFieldType {
  if (BOOL_TYPES.test(rawType)) return "boolean";
  if (NUMBER_TYPES.test(rawType)) return "number";
  if (DATE_TYPES.test(rawType)) return "date";
  return "string";
}

function stripQuotes(identifier: string): string {
  return identifier.replace(/^[`"[]|[`"\]]$/g, "").trim();
}

/** Last segment of a possibly db-qualified name: `db`.`table` → table. */
function tableNameOf(raw: string): string {
  const segments = raw.split(".");
  return stripQuotes(segments[segments.length - 1] ?? raw);
}

/**
 * Splits a dump into statements. String-aware; strips `--`, `#`, and C-style
 * comments; honors client DELIMITER directives so trigger/procedure bodies
 * arrive as single (ignorable) statements instead of leaking their inner
 * INSERTs as data.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let delimiter = ";";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];

    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "#") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (current.trim() === "" && /^delimiter\s/i.test(sql.slice(i, i + 10))) {
      let lineEnd = i;
      while (lineEnd < n && sql[lineEnd] !== "\n") lineEnd++;
      const parts = sql.slice(i, lineEnd).trim().split(/\s+/);
      delimiter = parts[1] ?? ";";
      i = lineEnd + 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      current += ch;
      i++;
      while (i < n) {
        const c = sql[i];
        if (c === "\\" && quote !== "`") {
          current += c + (sql[i + 1] ?? "");
          i += 2;
          continue;
        }
        current += c;
        i++;
        if (c === quote) {
          // '' / "" style escaped quote continues the literal.
          if (sql[i] === quote) {
            current += sql[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (sql.startsWith(delimiter, i)) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i += delimiter.length;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Splits `body` on top-level commas (paren- and string-aware). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      current += ch;
      i++;
      while (i < body.length) {
        const c = body[i];
        if (c === "\\" && quote !== "`") {
          current += c + (body[i + 1] ?? "");
          i += 2;
          continue;
        }
        current += c;
        i++;
        if (c === quote) {
          if (body[i] === quote) {
            current += body[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Body between the first "(" and its matching ")" (string-aware). */
function parenBody(statement: string, from: number): { body: string; end: number } | null {
  const start = statement.indexOf("(", from);
  if (start < 0) return null;
  let depth = 0;
  let i = start;
  while (i < statement.length) {
    const ch = statement[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < statement.length) {
        const c = statement[i];
        if (c === "\\" && quote !== "`") {
          i += 2;
          continue;
        }
        i++;
        if (c === quote) {
          if (statement[i] === quote) {
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return { body: statement.slice(start + 1, i), end: i };
    }
    i++;
  }
  return null;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (/^null$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return Number(value);
  const quote = value[0];
  if ((quote === "'" || quote === '"') && value.endsWith(quote) && value.length >= 2) {
    const inner = value.slice(1, -1);
    return inner
      .replace(new RegExp(`${quote}${quote}`, "g"), quote)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  // Function calls / keywords (CURRENT_TIMESTAMP, NOW(), DEFAULT, …) — keep verbatim.
  return value;
}

export function parseSqlDump(sql: string): SqlDumpResult {
  const declaredTypes = new Map<string, Map<string, SqlFieldType>>();
  const declaredOrder = new Map<string, string[]>();
  const rowsByTable = new Map<string, Record<string, unknown>[]>();
  const columnOrderSeen = new Map<string, string[]>();
  const allRelations: SqlDumpRelation[] = [];
  /** Single-column AUTO_INCREMENT/PRIMARY KEY per table (for value synthesis). */
  const pkByTable = new Map<string, string>();
  const pkCounters = new Map<string, number>();

  for (const statement of splitStatements(sql)) {
    const createMatch = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([`"[\]\w.]+)/i.exec(statement);
    if (createMatch) {
      const table = tableNameOf(createMatch[1]);
      const paren = parenBody(statement, createMatch[0].length);
      if (!paren) continue;
      const types = new Map<string, SqlFieldType>();
      const order: string[] = [];
      for (const columnDef of splitTopLevel(paren.body)) {
        const firstToken = columnDef.split(/\s+/)[0] ?? "";
        if (CONSTRAINT_KEYWORDS.has(stripQuotes(firstToken).toLowerCase())) {
          // Table-level PRIMARY KEY (col) — single-column only.
          const pkMatch = /^primary\s+key\s*\(\s*([`"[\]\w]+)\s*\)/i.exec(columnDef);
          if (pkMatch && !pkByTable.has(table)) {
            pkByTable.set(table, stripQuotes(pkMatch[1]));
          }
          // Table-level FOREIGN KEY (col) REFERENCES tbl (col).
          const fkMatch =
            /foreign\s+key\s*\(\s*([`"[\]\w]+)\s*\)\s*references\s+([`"[\]\w.]+)\s*\(\s*([`"[\]\w]+)\s*\)/i.exec(
              columnDef,
            );
          if (fkMatch) {
            allRelations.push({
              fromTable: table,
              fromField: stripQuotes(fkMatch[1]),
              toTable: tableNameOf(fkMatch[2]),
              toField: stripQuotes(fkMatch[3]),
            });
          }
          continue;
        }
        const match = /^([`"[\]\w]+)\s+([a-zA-Z]+)/.exec(columnDef);
        if (!match) continue;
        const columnName = stripQuotes(match[1]);
        // Generated columns are schema-only; INSERTs never carry them, so the
        // field list is ultimately driven by the columns seen in data rows.
        types.set(columnName, mapSqlType(match[2]));
        order.push(columnName);
        // Inline AUTO_INCREMENT / PRIMARY KEY column.
        if (
          !pkByTable.has(table) &&
          (/\bauto_increment\b/i.test(columnDef) || /\bprimary\s+key\b/i.test(columnDef))
        ) {
          pkByTable.set(table, columnName);
        }
        // Inline column-level REFERENCES tbl (col).
        const inlineRef = /\breferences\s+([`"[\]\w.]+)\s*\(\s*([`"[\]\w]+)\s*\)/i.exec(columnDef);
        if (inlineRef) {
          allRelations.push({
            fromTable: table,
            fromField: columnName,
            toTable: tableNameOf(inlineRef[1]),
            toField: stripQuotes(inlineRef[2]),
          });
        }
      }
      declaredTypes.set(table, types);
      declaredOrder.set(table, order);
      continue;
    }

    const insertMatch = /^insert\s+(?:ignore\s+)?into\s+([`"[\]\w.]+)\s*/i.exec(statement);
    if (!insertMatch) continue;
    const table = tableNameOf(insertMatch[1]);
    let cursor = insertMatch[0].length;

    // Optional explicit column list.
    let columns: string[] | null = null;
    if (statement[cursor] === "(") {
      const paren = parenBody(statement, cursor);
      if (!paren) continue;
      columns = splitTopLevel(paren.body).map(stripQuotes);
      cursor = paren.end + 1;
    }

    const rest = statement.slice(cursor);
    const valuesMatch = /^\s*values?\s*/i.exec(rest);
    // INSERT ... SELECT (and other forms) can't be evaluated statically — skip.
    if (!valuesMatch) continue;

    const resolvedColumns = columns ?? declaredOrder.get(table) ?? null;
    if (!resolvedColumns || resolvedColumns.length === 0) continue;

    // AUTO_INCREMENT keys are usually omitted from dump INSERTs (the DB
    // assigns them 1..N on import) while child-table FKs reference those
    // values — synthesize the same sequence so relations stay joinable.
    const pk = pkByTable.get(table);
    const synthesizePk = pk !== undefined && !resolvedColumns.includes(pk);
    if (!columnOrderSeen.has(table)) {
      columnOrderSeen.set(table, synthesizePk ? [pk, ...resolvedColumns] : resolvedColumns);
    }

    let offset = cursor + valuesMatch[0].length;
    const tableRows = rowsByTable.get(table) ?? [];
    while (true) {
      const tuple = parenBody(statement, offset);
      if (!tuple) break;
      const values = splitTopLevel(tuple.body).map(parseScalar);
      if (values.length === resolvedColumns.length) {
        const row: Record<string, unknown> = {};
        if (synthesizePk) {
          const next = (pkCounters.get(table) ?? 0) + 1;
          pkCounters.set(table, next);
          row[pk] = next;
        }
        resolvedColumns.forEach((column, index) => {
          row[column] = values[index];
        });
        tableRows.push(row);
      }
      offset = tuple.end + 1;
    }
    if (tableRows.length > 0) rowsByTable.set(table, tableRows);
  }

  const tables: SqlDumpTable[] = [];
  for (const [name, rows] of rowsByTable) {
    const types = declaredTypes.get(name) ?? new Map<string, SqlFieldType>();
    const fields = (columnOrderSeen.get(name) ?? Object.keys(rows[0] ?? {})).map((column) => ({
      name: column,
      type: types.get(column) ?? inferType(rows, column),
    }));
    const declaredPk = pkByTable.get(name);
    const pk = declaredPk && fields.some((field) => field.name === declaredPk) ? declaredPk : null;
    tables.push({ name, fields, rows, pk });
  }

  // Relations only make sense between tables that actually become collections.
  const importedTables = new Set(tables.map((table) => table.name));
  const relations = allRelations.filter(
    (relation) => importedTables.has(relation.fromTable) && importedTables.has(relation.toTable),
  );

  return { tables, relations };
}

function inferType(rows: Record<string, unknown>[], column: string): SqlFieldType {
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(value)) return "date";
    return "string";
  }
  return "string";
}
