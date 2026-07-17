import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { selectUnseenCount, useNotificationStore } from "@/store/notificationStore";
import type { AppNotification, NotificationKind } from "@/store/notificationStore";
import { timeAgo } from "@/lib/timeAgo";
import { cn } from "@/lib/utils";

const SHAKE_RETRIGGER_MS = 8_000;

function KindIcon({ kind }: { kind: NotificationKind }) {
  if (kind === "success") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={16}
        className="mt-0.5 shrink-0 text-emerald-500"
      />
    );
  }
  if (kind === "error") {
    return (
      <HugeiconsIcon icon={AlertCircleIcon} size={16} className="mt-0.5 shrink-0 text-rose-500" />
    );
  }
  return (
    <HugeiconsIcon
      icon={InformationCircleIcon}
      size={16}
      className="mt-0.5 shrink-0 text-accent-blue"
    />
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const notifications = useNotificationStore((state) => state.notifications);
  const unseenCount = useNotificationStore(selectUnseenCount);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllSeen = useNotificationStore((state) => state.markAllSeen);
  const clearAll = useNotificationStore((state) => state.clearAll);

  // Remounting the icon span (via key) restarts the one-shot shake animation:
  // once when a new notification arrives, then every ~8s while any are unseen.
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    if (unseenCount === 0) return;
    setShakeKey((key) => key + 1);
    const interval = setInterval(
      () => setShakeKey((key) => key + 1),
      SHAKE_RETRIGGER_MS,
    );
    return () => clearInterval(interval);
  }, [unseenCount]);

  function handleOpenChange(open: boolean) {
    if (open) markAllSeen();
  }

  function handleItemClick(notification: AppNotification) {
    markRead(notification.id);
    if (notification.link) navigate(notification.link);
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            unseenCount > 0 ? `Notifications (${unseenCount} new)` : "Notifications"
          }
          className="relative flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card transition-all duration-150 ease-in-out hover:text-ink hover:shadow-lg hover:shadow-black/5 active:scale-95"
        >
          <span key={shakeKey} className={cn(unseenCount > 0 && "animate-bell-shake")}>
            <HugeiconsIcon icon={Notification03Icon} size={16} />
          </span>
          {unseenCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
              {unseenCount > 9 ? "9+" : unseenCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
          <span className="text-sm font-semibold text-ink">Notifications</span>
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              Clear all
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            No notifications yet
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto p-1">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => handleItemClick(notification)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-muted",
                  !notification.read && "bg-accent-blue/5",
                )}
              >
                <KindIcon kind={notification.kind} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">
                      {notification.title}
                    </span>
                    {!notification.read && (
                      <span
                        aria-label="Unread"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-blue"
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    {notification.body}
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-muted/70">
                    {timeAgo(notification.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
