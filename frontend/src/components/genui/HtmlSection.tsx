import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import type { HtmlWidget } from "@/types/dashboard";

/**
 * Second sanitization pass on top of the server's sanitize-html run — belt
 * and suspenders, since this content round-trips through the database.
 * DOMPurify already strips scripts, event handlers, and javascript: URLs by
 * default; the FORBID list removes embedding/navigation vectors on top.
 */
const PURIFY_CONFIG: Config = {
  FORBID_TAGS: ["iframe", "object", "embed", "form", "base", "link", "meta"],
  FORBID_ATTR: ["target"],
};

/**
 * Renders a free-form "html" widget inside a shadow root: its <style> rules
 * and class names stay scoped to the section and can never restyle the app.
 */
export function HtmlSection({ widget }: { widget: HtmlWidget }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = DOMPurify.sanitize(widget.content, PURIFY_CONFIG);
  }, [widget.content]);

  return <div ref={hostRef} />;
}
