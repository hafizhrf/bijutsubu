import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { useUploadQueueStore } from "@/store/uploadQueueStore";

type Phase = "hidden" | "active" | "success";

export function QueueIndicator() {
  const items = useUploadQueueStore((state) => state.items);
  const navigate = useNavigate();

  const activeCount = items.filter(
    (item) =>
      item.status === "queued" ||
      item.status === "uploading" ||
      item.status === "waiting" ||
      item.status === "needs-decision",
  ).length;
  const decisionCount = items.filter((item) => item.status === "needs-decision").length;
  const doneCount = items.filter((item) => item.status === "done").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const waitingItem = items.find((item) => item.status === "waiting" && item.retryAt !== null);
  const waitingId = waitingItem?.id ?? null;

  const [phase, setPhase] = useState<Phase>("hidden");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activeCount > 0) {
      setPhase("active");
    } else {
      setPhase((prev) => (prev === "active" ? "success" : prev));
    }
  }, [activeCount]);

  useEffect(() => {
    if (phase !== "success") return;
    const timer = setTimeout(() => setPhase("hidden"), 5000);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!waitingId) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [waitingId]);

  if (phase === "hidden") return null;

  const retrySeconds =
    waitingItem?.retryAt != null ? Math.max(0, Math.ceil((waitingItem.retryAt - now) / 1000)) : null;

  return (
    <button
      type="button"
      onClick={() => navigate("/documents")}
      className="fixed bottom-6 right-6 z-50 flex animate-fade-in-up items-center gap-2.5 rounded-full bg-sidebar py-2.5 pl-4 pr-3 text-sm font-medium text-sidebar-ink shadow-lg shadow-black/20 transition-transform duration-150 ease-in-out hover:scale-[1.03] active:scale-[0.98]"
      aria-label="View upload queue"
    >
      {phase === "active" ? (
        <>
          <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin text-hero-from" />
          <span>
            {doneCount} of {items.length} uploaded
            {retrySeconds !== null && (
              <span className="text-sidebar-ink/60"> · next in {retrySeconds}s</span>
            )}
            {decisionCount > 0 && (
              <span className="text-amber-300"> · needs your decision</span>
            )}
          </span>
        </>
      ) : (
        <>
          {errorCount > 0 ? (
            <HugeiconsIcon icon={AlertCircleIcon} size={16} className="text-amber-400" />
          ) : (
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-emerald-400" />
          )}
          <span>
            All uploads finished
            {errorCount > 0 && <span className="text-white/60"> · {errorCount} failed</span>}
          </span>
          <span
            role="button"
            aria-label="Dismiss"
            onClick={(event) => {
              event.stopPropagation();
              setPhase("hidden");
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </span>
        </>
      )}
    </button>
  );
}
