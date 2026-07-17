import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyMode,
  applyTheme,
  DEFAULT_THEME_ID,
  DEFAULT_THEME_MODE,
  watchSystemMode,
} from "@/lib/themes";
import type { ThemeMode } from "@/lib/themes";

interface SettingsState {
  themeId: string;
  mode: ThemeMode;
  sidebarPinned: boolean;
  notifySuccess: boolean;
  notifyFailure: boolean;
  setTheme: (themeId: string) => void;
  setMode: (mode: ThemeMode) => void;
  setSidebarPinned: (sidebarPinned: boolean) => void;
  setNotifySuccess: (enabled: boolean) => void;
  setNotifyFailure: (enabled: boolean) => void;
}

/**
 * Display preferences persisted to localStorage (device-scoped by design).
 * Theme CSS variables and the light/dark class are (re)applied both on change
 * and on rehydrate; index.html also applies the dark class pre-paint so a
 * dark reload never flashes light.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeId: DEFAULT_THEME_ID,
      mode: DEFAULT_THEME_MODE,
      sidebarPinned: false,
      notifySuccess: true,
      notifyFailure: true,
      setTheme: (themeId) => {
        applyTheme(themeId);
        set({ themeId });
      },
      setMode: (mode) => {
        applyMode(mode);
        set({ mode });
      },
      setSidebarPinned: (sidebarPinned) => set({ sidebarPinned }),
      setNotifySuccess: (notifySuccess) => set({ notifySuccess }),
      setNotifyFailure: (notifyFailure) => set({ notifyFailure }),
    }),
    {
      name: "bijustubu-settings",
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.themeId ?? DEFAULT_THEME_ID);
        applyMode(state?.mode ?? DEFAULT_THEME_MODE);
      },
    },
  ),
);

// "system" mode follows the OS preference live for the rest of the session.
watchSystemMode(() => useSettingsStore.getState().mode);
