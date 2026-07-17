import sanitizeHtml from "sanitize-html";
import { UiSpec } from "../schemas/uiSpec.schema.js";

/**
 * Server-side sanitization for "html" widgets, applied once at generation
 * time (before the uiSpec is saved). Strips anything executable — scripts,
 * iframes/embeds, event-handler attributes, javascript: URLs — while keeping
 * layout/styling markup so free-form pages still look designed. The client
 * sanitizes again (DOMPurify) and renders inside a shadow root, so <style>
 * rules can't leak into the app either.
 */

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "style",
    "button",
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "g",
    "defs",
    "linearGradient",
    "radialGradient",
    "stop",
    "text",
  ],
  allowedAttributes: {
    "*": ["style", "class", "id", "title", "role", "aria-*", "align", "width", "height"],
    a: ["href", "target", "rel", "style", "class"],
    img: ["src", "alt", "width", "height", "style", "class", "loading"],
    svg: ["viewBox", "xmlns", "fill", "stroke", "width", "height", "style", "class"],
    path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"],
    circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width"],
    rect: ["x", "y", "rx", "ry", "fill", "stroke", "stroke-width"],
    line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width"],
    polyline: ["points", "fill", "stroke", "stroke-width"],
    polygon: ["points", "fill", "stroke", "stroke-width"],
    g: ["fill", "stroke", "transform"],
    linearGradient: ["id", "x1", "y1", "x2", "y2"],
    radialGradient: ["id", "cx", "cy", "r"],
    stop: ["offset", "stop-color", "stop-opacity"],
    text: ["x", "y", "fill", "font-size", "text-anchor"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  // <style> is only "vulnerable" when rendered into the page's own DOM — the
  // client renders html widgets inside a shadow root, so its rules are scoped.
  allowVulnerableTags: true,
  disallowedTagsMode: "discard",
};

export function sanitizeWidgetHtml(content: string): string {
  return sanitizeHtml(content, SANITIZE_OPTIONS);
}

/** Returns the spec with every html widget's content sanitized in place. */
export function sanitizeUiSpecHtml(uiSpec: UiSpec): UiSpec {
  return {
    ...uiSpec,
    widgets: uiSpec.widgets.map((widget) =>
      widget.type === "html" ? { ...widget, content: sanitizeWidgetHtml(widget.content) } : widget,
    ),
  };
}
