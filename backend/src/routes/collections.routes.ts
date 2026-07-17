import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  customTableQuery,
  deleteCustomTable,
  exportCustomTable,
  getCustomTable,
  listCollections,
  listCustomTables,
  listRelations,
  renameCustomTable,
  sampleCollection,
  saveCustomTable,
  updateRelations,
} from "../controllers/collections.controller.js";
import {
  addField,
  createRelation,
  deleteCollection,
  deleteField,
  deleteRelation,
  deleteRow,
  deleteRows,
  exportRows,
  getCollectionDependencies,
  getRowDependencies,
  insertRow,
  listRows,
  patchRelation,
  updateCollection,
  updateField,
  updateRow,
} from "../controllers/collectionsEditor.controller.js";

export const collectionsRouter = Router();

collectionsRouter.use(requireAuth);

collectionsRouter.get("/", listCollections);

// NL → custom table (shares the genui rate-limit window with dashboard generation).
collectionsRouter.post("/query", rateLimit("genui"), customTableQuery);

// Saved custom tables (no LLM, no rate limit) — before the /:name routes.
collectionsRouter.post("/custom-tables", saveCustomTable);
collectionsRouter.get("/custom-tables", listCustomTables);
collectionsRouter.get("/custom-tables/:id", getCustomTable);
collectionsRouter.get("/custom-tables/:id/export", exportCustomTable);
collectionsRouter.patch("/custom-tables/:id", renameCustomTable);
collectionsRouter.delete("/custom-tables/:id", deleteCustomTable);

// Relation routes must register before the parameterized /:name routes.
collectionsRouter.get("/relations", listRelations);
collectionsRouter.post("/relations", createRelation);
collectionsRouter.post("/relations/prompt", updateRelations);
collectionsRouter.patch("/relations/:id", patchRelation);
collectionsRouter.delete("/relations/:id", deleteRelation);

collectionsRouter.get("/:name/dependencies", getCollectionDependencies);
// POST body (ids) — same rationale as bulk delete below.
collectionsRouter.post("/:name/rows/dependencies", getRowDependencies);
collectionsRouter.get("/:name/sample", sampleCollection);
collectionsRouter.get("/:name/rows", listRows);
collectionsRouter.get("/:name/export", exportRows);
collectionsRouter.post("/:name/rows", insertRow);
// Bulk delete uses POST because DELETE bodies are unreliable across proxies.
collectionsRouter.post("/:name/rows/delete", deleteRows);
collectionsRouter.patch("/:name/rows/:rowId", updateRow);
collectionsRouter.delete("/:name/rows/:rowId", deleteRow);
collectionsRouter.post("/:name/fields", addField);
collectionsRouter.patch("/:name/fields/:field", updateField);
collectionsRouter.delete("/:name/fields/:field", deleteField);
collectionsRouter.patch("/:name", updateCollection);
collectionsRouter.delete("/:name", deleteCollection);
