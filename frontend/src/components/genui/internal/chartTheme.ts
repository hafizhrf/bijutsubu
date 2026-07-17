import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useIsDark } from "@/lib/useIsDark";

/**
 * Shared Recharts styling so every chart tooltip/axis reads as one system:
 * rounded card with a soft shadow (no default border), quiet 11px ticks.
 * Colors come from the --chart-* CSS tokens (light/dark aware) — Recharts
 * needs concrete strings, so useChartTheme snapshots them and recomputes
 * when the dark class flips.
 */

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Numeric axis tick formatter: 6100000 → "6.1M". Value axes have a fixed
 * 40px width, so unabbreviated large numbers get clipped on the left.
 */
export function formatAxisNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? compactNumber.format(value) : String(value ?? "");
}

export interface ChartTheme {
  gridColor: string;
  axisTick: { fontSize: number; fill: string };
  tooltipStyle: CSSProperties;
  tooltipLabelStyle: CSSProperties;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

export function readChartTheme(): ChartTheme {
  const styles = getComputedStyle(document.documentElement);
  return {
    gridColor: readVar(styles, "--chart-grid", "#e7e5df"),
    axisTick: { fontSize: 11, fill: readVar(styles, "--chart-tick", "#8a8790") },
    tooltipStyle: {
      borderRadius: 14,
      border: "none",
      boxShadow: readVar(styles, "--chart-tooltip-shadow", "0 10px 30px rgba(15, 23, 42, 0.14)"),
      backgroundColor: readVar(styles, "--chart-tooltip-bg", "#ffffff"),
      fontSize: 12.5,
      padding: "10px 14px",
    },
    tooltipLabelStyle: {
      fontWeight: 600,
      color: readVar(styles, "--chart-tooltip-label", "#3f3d45"),
      marginBottom: 4,
    },
  };
}

export function useChartTheme(): ChartTheme {
  const isDark = useIsDark();
  return useMemo(() => {
    // isDark is the recompute trigger; values themselves come from the CSS vars.
    void isDark;
    return readChartTheme();
  }, [isDark]);
}
