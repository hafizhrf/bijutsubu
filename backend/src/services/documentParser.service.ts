import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import mammoth from "mammoth";

export type ParsedDocument =
  | { kind: "rows"; rows: Record<string, unknown>[] }
  | { kind: "text"; text: string };

export async function parseDocument(
  buffer: Buffer,
  mimetype: string,
  originalName: string,
): Promise<ParsedDocument> {
  const ext = originalName.toLowerCase().split(".").pop() ?? "";

  if (mimetype === "application/pdf" || ext === "pdf") {
    return parsePdf(buffer);
  }

  if (mimetype === "text/csv" || ext === "csv") {
    return parseCsv(buffer);
  }

  if (
    mimetype === "application/vnd.ms-excel" ||
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xls" ||
    ext === "xlsx"
  ) {
    return parseExcel(buffer);
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return parseDocx(buffer);
  }

  // .sql rides the plain-text path: the extraction planner is shape-driven
  // and pulls records out of raw text (CREATE TABLE/INSERT statements included).
  if (
    mimetype === "text/markdown" || ext === "md" ||
    mimetype === "text/plain" || ext === "txt" ||
    mimetype === "application/sql" || mimetype === "application/x-sql" || ext === "sql"
  ) {
    return { kind: "text", text: buffer.toString("utf-8") };
  }

  throw new Error(`Unsupported file type: ${mimetype || ext}`);
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { kind: "text", text: result.text };
  } finally {
    await parser.destroy();
  }
}

function parseCsv(buffer: Buffer): ParsedDocument {
  const result = Papa.parse<Record<string, unknown>>(buffer.toString("utf-8"), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  return { kind: "rows", rows: result.data };
}

function parseExcel(buffer: Buffer): ParsedDocument {
  // cellDates: date-formatted cells arrive as JS Date objects instead of
  // opaque Excel serial numbers, so they can be stored as real BSON dates.
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { kind: "rows", rows: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  return { kind: "rows", rows };
}

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  return { kind: "text", text: result.value };
}
