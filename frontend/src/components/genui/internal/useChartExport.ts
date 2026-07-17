import { useCallback, useRef } from "react";
import { downloadBlob } from "@/lib/download";

/**
 * PNG export for a Recharts widget without any extra dependency: serialize
 * the chart's <svg>, rasterize it onto a 2x canvas painted with the current
 * surface color (so dark mode exports don't come out transparent-on-black),
 * and download the result.
 */
export function useChartExport(title: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const exportPng = useCallback(() => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    // Clone so we can pin explicit pixel dimensions without touching the DOM.
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const surface =
      getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim() ||
      "#ffffff";

    const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = surface;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);
        ctx.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) {
            const safeName = title.replace(/[^\w-]+/g, "-").toLowerCase() || "chart";
            downloadBlob(blob, `${safeName}.png`);
          }
        }, "image/png");
      }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }, [title]);

  return { containerRef, exportPng };
}
