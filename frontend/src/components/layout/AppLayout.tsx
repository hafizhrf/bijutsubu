import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarLeft01Icon } from "@hugeicons/core-free-icons";
import { MobileSidebar, Sidebar } from "@/components/layout/Sidebar";
import { QueueIndicator } from "@/components/upload/QueueIndicator";

export function AppLayout() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

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
    </div>
  );
}
