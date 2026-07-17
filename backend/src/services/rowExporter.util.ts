import { Response } from "express";
import mongoose from "mongoose";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ExportFormat = "csv" | "xlsx" | "json";

export function parseExportFormat(raw: unknown): ExportFormat {
  return raw === "xlsx" || raw === "json" ? raw : "csv";
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** JSON keeps native numbers/booleans; ObjectIds and Dates serialize as strings. */
function jsonValue(value: unknown): unknown {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Excel cells keep numbers/booleans/dates natively; objects flatten to JSON text. */
function xlsxValue(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (value instanceof Date) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/**
 * Streams tabular rows to the response in the requested format. `fieldNames`
 * fixes the column set and order; `filename` is the extension-less base name.
 */
export function sendRowsExport(
  res: Response,
  format: ExportFormat,
  filename: string,
  fieldNames: string[],
  rows: Record<string, unknown>[],
): void {
  const safeName = filename.replace(/[^\w-]+/g, "-") || "export";

  if (format === "json") {
    const data = rows.map((row) =>
      Object.fromEntries(fieldNames.map((field) => [field, jsonValue(row[field]) ?? null])),
    );
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.json"`);
    res.status(200).send(JSON.stringify(data, null, 2));
    return;
  }

  if (format === "xlsx") {
    const data = rows.map((row) =>
      Object.fromEntries(fieldNames.map((field) => [field, xlsxValue(row[field])])),
    );
    const sheet = XLSX.utils.json_to_sheet(data, { header: fieldNames, cellDates: true });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Data");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xlsx"`);
    res.status(200).send(buffer);
    return;
  }

  const data = rows.map((row) => fieldNames.map((field) => cellText(row[field])));
  const csv = Papa.unparse({ fields: fieldNames, data });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
  // BOM keeps Excel happy with UTF-8 (csv only).
  res.status(200).send(`﻿${csv}`);
}
