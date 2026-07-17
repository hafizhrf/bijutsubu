import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "@/components/notifications/GlobalSearch";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useSettingsStore } from "@/store/settingsStore";

interface TopBarProps {
  title: string;
  action?: ReactNode;
}

/**
 * Page header that fluidly condenses on scroll: rendered via portal as a
 * viewport-fixed bar (the page wrapper's transform would break position:fixed)
 * hugging the sidebar's right edge. At rest it's transparent and tall; once
 * the page scrolls it shrinks, turns white, and casts a bottom shadow — all
 * transitioned. The in-flow spacer reserves the bar's resting footprint.
 */
export function TopBar({ title, action }: TopBarProps) {
  const [scrolled, setScrolled] = useState(false);
  const spacerRef = useRef<HTMLDivElement>(null);
  const sidebarPinned = useSettingsStore((state) => state.sidebarPinned);

  useEffect(() => {
    // The app scrolls inside <main>, not the window.
    const scroller = spacerRef.current?.closest("main");
    if (!scroller) return;
    function onScroll() {
      setScrolled((scroller as HTMLElement).scrollTop > 12);
    }
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Reserves the resting bar height inside the page flow (main already
          contributes 32px top padding; 64px here puts content just below the
          96px resting bar). */}
      <div ref={spacerRef} className="h-16" aria-hidden="true" />
      <div className="mb-8" aria-hidden="true" />

      {createPortal(
        <div
          className={cn(
            "fixed right-0 top-0 z-30 flex items-center transition-all duration-300 ease-out",
            sidebarPinned ? "left-0 md:left-60" : "left-0 md:left-20",
            scrolled
              ? "h-[4.5rem] bg-surface/95 shadow-[0_10px_28px_-14px_rgba(11,11,15,0.25)] backdrop-blur"
              : "h-24 bg-transparent",
          )}
        >
          <div className="flex w-full flex-wrap items-center justify-between gap-4 px-4 pl-16 md:px-10">
            <h1
              className={cn(
                "font-bold tracking-tight text-ink transition-all duration-300 ease-out",
                scrolled ? "text-xl" : "text-3xl",
              )}
            >
              {title}
            </h1>

            <div className="flex items-center gap-3">
              <GlobalSearch />
              <NotificationBell />
              {action}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
