import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { isAxiosError } from "axios";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CloudUploadIcon,
  Loading03Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { Lottie } from "@/components/ui/lottie";
import emptyAstronaut from "@/assets/lottie/empty-astronaut.lottie";
import { listKnowledgeDocuments, uploadKnowledgeDocument } from "@/api/knowledge";
import {
  KnowledgeDocumentList,
  isIndexingPending,
} from "@/components/knowledge/KnowledgeDocumentList";
import { DocumentViewerDialog } from "@/components/knowledge/DocumentViewerDialog";
import { DeleteKnowledgeDocumentDialog } from "@/components/knowledge/DeleteKnowledgeDocumentDialog";
import { KnowledgeChatPanel } from "@/components/knowledge/KnowledgeChatPanel";
import type { KnowledgeDocument } from "@/types/knowledge";
import { useNotificationStore } from "@/store/notificationStore";

// Mirrors the backend KB allowlist (config/rateLimit.ts) — any Dify-indexable
// document, images excluded.
const KB_ACCEPT: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "text/html": [".html", ".htm"],
  "application/json": [".json"],
  "application/xml": [".xml"],
};

const FORMAT_CHIPS = ["PDF", "DOCX", "PPTX", "XLSX", "CSV", "TXT", "MD", "HTML", "JSON", "XML"];

interface UploadingFile {
  id: number;
  name: string;
  progress: number;
  error: string | null;
}

let uploadCounter = 0;

export default function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mobileTab = searchParams.get("tab") === "chat" ? "chat" : "documents";
  const queryClient = useQueryClient();
  const [viewDoc, setViewDoc] = useState<KnowledgeDocument | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<KnowledgeDocument | null>(null);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const documentsQuery = useQuery({
    queryKey: ["knowledge", "documents", page, debouncedSearch],
    queryFn: () => listKnowledgeDocuments({ page, search: debouncedSearch }),
    placeholderData: keepPreviousData,
    // Poll while any document on this page is still being indexed by Dify.
    refetchInterval: (query) =>
      query.state.data?.documents.some((doc) => isIndexingPending(doc.indexingStatus))
        ? 4000
        : false,
  });
  const documents = documentsQuery.data?.documents ?? [];
  const total = documentsQuery.data?.total ?? 0;
  const pageSize = documentsQuery.data?.pageSize ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const datasetReady = documentsQuery.data?.datasetReady ?? false;

  async function openSource(name: string) {
    const local = documents.find((entry) => entry.name === name);
    if (local) {
      setViewDoc(local);
      return;
    }
    try {
      const result = await listKnowledgeDocuments({ page: 1, search: name });
      const match = result.documents.find((entry) => entry.name === name);
      if (match) setViewDoc(match);
      else throw new Error("source_not_found");
    } catch {
      useNotificationStore.getState().push({
        kind: "info",
        title: "Source unavailable",
        body: name,
        link: null,
      });
    }
  }

  const startUpload = useCallback(
    async (file: File) => {
      const id = ++uploadCounter;
      setUploading((prev) => [...prev, { id, name: file.name, progress: 0, error: null }]);
      try {
        await uploadKnowledgeDocument(file, (percent) => {
          setUploading((prev) =>
            prev.map((item) => (item.id === id ? { ...item, progress: percent } : item)),
          );
        });
        setUploading((prev) => prev.filter((item) => item.id !== id));
        queryClient.invalidateQueries({ queryKey: ["knowledge", "documents"] });
      } catch (error) {
        let message = "Upload failed — try again.";
        if (isAxiosError(error) && error.response) {
          if (error.response.status === 415) message = "Unsupported file type.";
          else if (error.response.status === 413) message = "File is too large (max 15MB).";
          else if (error.response.status === 429) {
            const seconds = Math.ceil(
              ((error.response.data as { retryAfterMs?: number })?.retryAfterMs ?? 60_000) / 1000,
            );
            message = `Rate limited — try again in ~${seconds}s.`;
          } else if (error.response.status === 502) {
            message = "Knowledge service is unreachable.";
          }
        }
        setUploading((prev) =>
          prev.map((item) => (item.id === id ? { ...item, error: message } : item)),
        );
      }
    },
    [queryClient],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      for (const file of accepted) void startUpload(file);
    },
    [startUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: KB_ACCEPT,
    multiple: true,
  });

  return (
    <div>
      <TopBar title="Knowledge" />

      <Tabs value={mobileTab} onValueChange={(value) => setSearchParams(value === "chat" ? { tab: "chat" } : {}, { replace: true })} className="mb-4 xl:hidden">
        <TabsList><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="chat">Chat</TabsTrigger></TabsList>
      </Tabs>

      <div className="grid items-start gap-6 xl:grid-cols-12">
        {/* Left: upload + document list */}
        <div className={cn("flex flex-col gap-6 xl:col-span-5 xl:flex", mobileTab === "documents" ? "flex" : "hidden")}>
          <Card>
            <CardContent className="p-4">
              <div
                {...getRootProps()}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3.5 transition-colors",
                  isDragActive
                    ? "border-accent-blue bg-accent-blue/5"
                    : "border-border-soft hover:border-accent-blue/50 hover:bg-surface-muted/60",
                )}
              >
                <input {...getInputProps()} />
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue">
                  <HugeiconsIcon icon={CloudUploadIcon} className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {isDragActive ? "Drop to add to your knowledge base" : "Add documents"}
                  </p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {FORMAT_CHIPS.join(" · ")} — no images, max 15MB
                  </p>
                </div>
              </div>

              {uploading.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {uploading.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2.5 rounded-xl bg-surface-muted px-3 py-2"
                    >
                      {item.error ? (
                        <HugeiconsIcon
                          icon={Alert02Icon}
                          className="h-3.5 w-3.5 shrink-0 text-rose-500"
                        />
                      ) : (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-blue"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{item.name}</span>
                      {item.error ? (
                        <button
                          type="button"
                          onClick={() =>
                            setUploading((prev) => prev.filter((entry) => entry.id !== item.id))
                          }
                          className="shrink-0 text-[11px] font-medium text-rose-600 hover:underline"
                          title={item.error}
                        >
                          {item.error}
                        </button>
                      ) : (
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
                          {item.progress}%
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Documents</CardTitle>
              <CardDescription>
                {total > 0
                  ? `${total.toLocaleString()} document${total === 1 ? "" : "s"} in your knowledge base.`
                  : "Everything you upload here becomes chatbot knowledge."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {(datasetReady || search !== "") && (
                <div className="relative mb-3">
                  <HugeiconsIcon
                    icon={Search01Icon}
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search documents…"
                    className="h-9 w-full rounded-full border border-border-soft bg-surface-muted pl-10 pr-4 text-sm text-ink transition-colors placeholder:text-ink-muted/70 focus:border-accent-blue/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                  />
                </div>
              )}
              {documentsQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-muted">
                  <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : documentsQuery.isError ? (
                <p className="py-6 text-center text-sm text-rose-600">
                  Knowledge service is unreachable — try again shortly.
                </p>
              ) : documents.length === 0 ? (
                debouncedSearch !== "" ? (
                  <p className="py-6 text-center text-sm text-ink-muted">
                    No documents match “{debouncedSearch}”.
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-1 py-4">
                    <Lottie src={emptyAstronaut} className="h-28 w-28" />
                    <p className="text-sm text-ink-muted">No documents yet — drop some above.</p>
                  </div>
                )
              ) : (
                <>
                  <div className={cn("max-h-[50vh] overflow-y-auto pr-1", THIN_SCROLLBAR_CLASS)}>
                    <KnowledgeDocumentList
                      documents={documents}
                      onView={setViewDoc}
                      onDelete={setDeleteDoc}
                    />
                  </div>
                  {totalPages > 1 && (
                    <div className="mt-3 flex items-center justify-between border-t border-border-soft pt-3">
                      <span className="text-[11px] tabular-nums text-ink-muted">
                        {((page - 1) * pageSize + 1).toLocaleString()}–
                        {Math.min(page * pageSize, total).toLocaleString()} of{" "}
                        {total.toLocaleString()}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Previous page"
                          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                          disabled={page <= 1 || documentsQuery.isFetching}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                        >
                          <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
                        </button>
                        <span className="text-[11px] tabular-nums text-ink-muted">
                          {page}/{totalPages}
                        </span>
                        <button
                          type="button"
                          title="Next page"
                          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                          disabled={page >= totalPages || documentsQuery.isFetching}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                        >
                          <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: RAG chat */}
        <Card className={cn("h-[calc(100vh-14rem)] min-h-[28rem] flex-col overflow-hidden p-0 xl:col-span-7 xl:flex", mobileTab === "chat" ? "flex" : "hidden")}>
          <KnowledgeChatPanel
            // While a search filter is active `total` is the filtered count,
            // so it can't be used to decide whether the KB is empty.
            hasDocuments={datasetReady && (debouncedSearch !== "" || total > 0)}
            onOpenSource={(name) => void openSource(name)}
          />
        </Card>
      </div>

      <DocumentViewerDialog doc={viewDoc} onClose={() => setViewDoc(null)} />
      <DeleteKnowledgeDocumentDialog doc={deleteDoc} onClose={() => setDeleteDoc(null)} />
    </div>
  );
}
