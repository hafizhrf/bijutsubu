import { useRef, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarLeft01Icon } from "@hugeicons/core-free-icons";
import { MobileSidebar, Sidebar } from "@/components/layout/Sidebar";
import { SettingsDialog, SETTINGS_SECTIONS } from "@/components/settings/SettingsDialog";
import type { SettingsSection } from "@/components/settings/SettingsDialog";
import { QueueIndicator } from "@/components/upload/QueueIndicator";

export function AppLayout() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // The settings modal is URL-backed (?settings=<section>) so it can open on
  // any protected page and deep links keep working. The last valid section is
  // remembered so the close animation doesn't flash the default section.
  const rawSection = searchParams.get("settings");
  const settingsSection = SETTINGS_SECTIONS.includes(rawSection as SettingsSection)
    ? (rawSection as SettingsSection)
    : null;
  const lastSectionRef = useRef<SettingsSection>("account");
  if (settingsSection) lastSectionRef.current = settingsSection;

  function setSettingsParam(section: SettingsSection | null) {
    const next = new URLSearchParams(searchParams);
    if (section) next.set("settings", section);
    else next.delete("settings");
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar />
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-ink shadow-card md:hidden"
      >
        <HugeiconsIcon icon={SidebarLeft01Icon} className="h-5 w-5" />
      </button>
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 md:px-10">
        <div key={pathname} className="animate-fade-in-up">
          <Outlet />
        </div>
      </main>
      <QueueIndicator />
      <SettingsDialog
        open={settingsSection !== null}
        section={settingsSection ?? lastSectionRef.current}
        onSectionChange={(section) => setSettingsParam(section)}
        onClose={() => setSettingsParam(null)}
      />
    </div>
  );
}
