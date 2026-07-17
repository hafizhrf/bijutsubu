/**
 * App color themes. The "primary" surfaces (sidebar rail, default buttons,
 * chat bubbles, active nav pill) all derive from the --color-sidebar tokens
 * in index.css, so a theme is just a runtime override of those variables.
 *
 * Pastel themes pair a soft primary surface with a deep same-hue `ink` for
 * the text on top of it (white text would wash out on pastel).
 */
export interface AppTheme {
  id: string;
  label: string;
  /** Primary surface (sidebar, buttons, user chat bubbles). */
  primary: string;
  /** Hover shade of the primary surface. */
  primaryHover: string;
  /** Text/icon color on top of the primary surface. */
  ink: string;
  /** Focus rings + small accents. */
  accent: string;
}

export const APP_THEMES: AppTheme[] = [
  {
    id: "noir",
    label: "Noir",
    primary: "#0d0d12",
    primaryHover: "#1c1c24",
    ink: "#ffffff",
    accent: "#5b7cfa",
  },
  {
    id: "sakura",
    label: "Sakura",
    primary: "#f8cdd8",
    primaryHover: "#f3b9c9",
    ink: "#7c2b47",
    accent: "#e88aa5",
  },
  {
    id: "peach",
    label: "Peach",
    primary: "#fbdcc2",
    primaryHover: "#f7cca9",
    ink: "#84461c",
    accent: "#efa268",
  },
  {
    id: "lemon",
    label: "Lemon",
    primary: "#f7eab8",
    primaryHover: "#f1df97",
    ink: "#6f581a",
    accent: "#d9bd55",
  },
  {
    id: "mint",
    label: "Mint",
    primary: "#cfe8d6",
    primaryHover: "#bcdec7",
    ink: "#29573e",
    accent: "#7cc79a",
  },
  {
    id: "sky",
    label: "Sky",
    primary: "#c5ddf2",
    primaryHover: "#b0d0ec",
    ink: "#1f4d74",
    accent: "#79aede",
  },
  {
    id: "lavender",
    label: "Lavender",
    primary: "#ded4f2",
    primaryHover: "#cfc1ec",
    ink: "#453372",
    accent: "#a68fd9",
  },
];

export const DEFAULT_THEME_ID = "noir";

export function applyTheme(themeId: string): void {
  const theme = APP_THEMES.find((t) => t.id === themeId) ?? APP_THEMES[0];
  const root = document.documentElement.style;
  root.setProperty("--color-sidebar", theme.primary);
  root.setProperty("--color-sidebar-hover", theme.primaryHover);
  root.setProperty("--color-sidebar-ink", theme.ink);
  root.setProperty("--color-accent-blue", theme.accent);
}

/**
 * Light/dark is a second, orthogonal dimension next to the accent theme: the
 * `dark` class on <html> swaps the token block in index.css. A pre-paint
 * script in index.html applies the same logic before React loads (no flash);
 * this function is the runtime source of truth after that.
 */
export type ThemeMode = "light" | "dark" | "system";

export const DEFAULT_THEME_MODE: ThemeMode = "dark";

const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

export function applyMode(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && darkMedia.matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Keeps "system" mode live: re-applies when the OS preference flips. */
export function watchSystemMode(getMode: () => ThemeMode): void {
  darkMedia.addEventListener("change", () => {
    if (getMode() === "system") applyMode("system");
  });
}
