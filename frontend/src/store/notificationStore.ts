import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSettingsStore } from "@/store/settingsStore";

export type NotificationKind = "success" | "error" | "info";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  kind: NotificationKind;
  /** In-app route to navigate to on click, e.g. "/documents" or "/dashboard?result=<genId>". */
  link: string | null;
  /** Read = the user clicked/opened this specific notification. */
  read: boolean;
  createdAt: number;
}

interface NotificationState {
  /** Newest first, capped at MAX_NOTIFICATIONS. */
  notifications: AppNotification[];
  /** Epoch ms of the last time the bell panel was opened. */
  lastSeenAt: number;
  push: (notification: Omit<AppNotification, "id" | "read" | "createdAt">) => void;
  markRead: (id: string) => void;
  markAllSeen: () => void;
  clearAll: () => void;
}

const MAX_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: [],
      lastSeenAt: 0,

      push: (notification) => {
        const preferences = useSettingsStore.getState();
        if (notification.kind === "success" && !preferences.notifySuccess) return;
        if (notification.kind === "error" && !preferences.notifyFailure) return;
        set((state) => ({
          notifications: [
            {
              ...notification,
              id: crypto.randomUUID(),
              read: false,
              createdAt: Date.now(),
            },
            ...state.notifications,
          ].slice(0, MAX_NOTIFICATIONS),
        }));
      },

      markRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((entry) =>
            entry.id === id ? { ...entry, read: true } : entry,
          ),
        })),

      markAllSeen: () => set({ lastSeenAt: Date.now() }),

      clearAll: () => set({ notifications: [] }),
    }),
    {
      name: "bijustubu-notifications",
      partialize: (state) => ({
        notifications: state.notifications,
        lastSeenAt: state.lastSeenAt,
      }),
    },
  ),
);

/**
 * Unseen = arrived after the bell was last opened. Drives the badge + shake,
 * so opening the panel calms the bell while items stay visually unread
 * until individually clicked.
 */
export const selectUnseenCount = (state: NotificationState): number =>
  state.notifications.filter((entry) => entry.createdAt > state.lastSeenAt).length;
