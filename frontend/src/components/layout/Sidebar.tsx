import { useRef } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Activity01Icon, BookOpen01Icon, CloudUploadIcon, DashboardCircleIcon, Database01Icon, Logout03Icon, Settings02Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/layout/BrandMark";
import { playBrandTransition } from "@/components/layout/BrandTransition";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const primaryItems = [
  { to: "/overview", label: "Overview", hint: "Workspace summary and insights", icon: SparklesIcon },
  { to: "/documents", label: "Documents", hint: "Import structured data", icon: CloudUploadIcon },
  { to: "/collections", label: "Collections", hint: "Browse data and relations", icon: Database01Icon },
  { to: "/dashboard", label: "Dashboards", hint: "Build visual reports", icon: DashboardCircleIcon },
  { to: "/knowledge", label: "Knowledge Base", hint: "Grounded document chat", icon: BookOpen01Icon },
];
const utilityItems = [{ to: "/logs", label: "Activity", icon: Activity01Icon }];
const SNAPPY = "cubic-bezier(0.16,1,0.3,1)";

function RailLabel({ children, className, visible }: { children: ReactNode; className?: string; visible: boolean }) {
  return <span className={cn("whitespace-nowrap text-sm font-medium transition-all duration-200", visible ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0 group-hover/rail:translate-x-0 group-hover/rail:opacity-100", className)} style={{ transitionTimingFunction: SNAPPY }}>{children}</span>;
}

/** Index of the item matching the current pathname (query strings in `to` ignored), or -1. */
function useActiveIndex(items: { to: string }[]): number {
  const { pathname } = useLocation();
  return items.findIndex(({ to }) => {
    const path = to.split("?")[0];
    return pathname === path || pathname.startsWith(`${path}/`);
  });
}

/**
 * The single active-state highlight shared by all rows of a nav list: instead
 * of each link toggling its own background, this pill glides to the active
 * row (rows are fixed-height, so offset = index * stride). When no row is
 * active it fades out in place and glides from its last position on return.
 */
function SlidingPill({ activeIndex, stride, className }: { activeIndex: number; stride: number; className: string }) {
  const lastIndex = useRef(0);
  if (activeIndex >= 0) lastIndex.current = activeIndex;
  const index = activeIndex >= 0 ? activeIndex : lastIndex.current;
  return <span aria-hidden className={cn("pointer-events-none absolute left-0 top-0 w-full transition-[transform,opacity,scale] duration-300", activeIndex < 0 && "scale-90 opacity-0", className)} style={{ transform: `translateY(${index * stride}px)`, transitionTimingFunction: SNAPPY }} />;
}

function NavRows({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const activeIndex = useActiveIndex(primaryItems);
  return <nav className="relative flex flex-col gap-1.5">
    <SlidingPill activeIndex={activeIndex} stride={54} className="h-12 rounded-2xl bg-sidebar-ink" />
    {primaryItems.map(({ to, label, hint, icon }) => (
      <NavLink key={to} to={to} onClick={onNavigate} title={expanded ? hint : `${label} — ${hint}`} className={({ isActive }) => cn("relative flex h-12 items-center rounded-2xl transition-colors duration-300 active:scale-[0.98]", isActive ? "text-sidebar" : "text-sidebar-ink/60 hover:bg-sidebar-ink/10 hover:text-sidebar-ink")}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center"><HugeiconsIcon icon={icon} size={20} /></span><RailLabel visible={expanded}>{label}</RailLabel>
      </NavLink>
    ))}
  </nav>;
}

function UtilityRows({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const routeActiveIndex = useActiveIndex(utilityItems);
  // Settings is not a route — it opens the URL-param-backed settings modal.
  const settingsOpen = searchParams.has("settings");
  const activeIndex = settingsOpen ? utilityItems.length : routeActiveIndex;
  const openSettings = () => {
    const next = new URLSearchParams(searchParams);
    next.set("settings", "appearance");
    setSearchParams(next, { replace: true });
    onNavigate?.();
  };
  return <nav className="relative flex flex-col gap-1">
    <SlidingPill activeIndex={activeIndex} stride={48} className="h-11 rounded-2xl bg-sidebar-ink/10" />
    {utilityItems.map(({ to, label, icon }) => (
      <NavLink key={to} to={to} onClick={onNavigate} title={expanded ? undefined : label} className={({ isActive }) => cn("relative flex h-11 items-center rounded-2xl transition-colors duration-300", isActive && !settingsOpen ? "text-sidebar-ink" : "text-sidebar-ink/60 hover:bg-sidebar-ink/10 hover:text-sidebar-ink")}>
        <span className="flex h-11 w-12 shrink-0 items-center justify-center"><HugeiconsIcon icon={icon} size={18} /></span><RailLabel visible={expanded}>{label}</RailLabel>
      </NavLink>
    ))}
    <button type="button" onClick={openSettings} title={expanded ? undefined : "Settings"} className={cn("relative flex h-11 items-center rounded-2xl transition-colors duration-300", settingsOpen ? "text-sidebar-ink" : "text-sidebar-ink/60 hover:bg-sidebar-ink/10 hover:text-sidebar-ink")}>
      <span className="flex h-11 w-12 shrink-0 items-center justify-center"><HugeiconsIcon icon={Settings02Icon} size={18} /></span><RailLabel visible={expanded}>Settings</RailLabel>
    </button>
  </nav>;
}

function ProfileMenu({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuthStore();
  const openAccountSettings = () => {
    onNavigate?.();
    const next = new URLSearchParams(searchParams);
    next.set("settings", "account");
    setSearchParams(next, { replace: true });
  };
  const initial = (user?.displayName || user?.email || "?")[0]?.toUpperCase() ?? "?";
  const signOut = () => {
    onNavigate?.();
    // Log out only once the cover hides the screen, so the workspace never
    // visibly flashes to the login page mid-transition.
    playBrandTransition(() => { logout(); navigate("/login"); });
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="flex h-12 w-full items-center gap-3 rounded-2xl text-left text-sidebar-ink/70 transition-colors hover:bg-sidebar-ink/10 hover:text-sidebar-ink">
      <Avatar className="ml-1 h-10 w-10 shrink-0 border border-sidebar-ink/10"><AvatarFallback className="bg-sidebar-ink/10 text-sidebar-ink">{initial}</AvatarFallback></Avatar>
      <RailLabel visible={expanded} className="min-w-0"><span className="block max-w-36 truncate text-sm text-sidebar-ink">{user?.displayName || user?.email?.split("@")[0]}</span><span className="block max-w-36 truncate text-[11px] font-normal text-sidebar-ink/55">{user?.email}</span></RailLabel>
    </button></DropdownMenuTrigger>
    <DropdownMenuContent side="right" align="end" className="w-56">
      <DropdownMenuItem onSelect={openAccountSettings}><HugeiconsIcon icon={Settings02Icon} className="mr-2 h-4 w-4" /> Account settings</DropdownMenuItem>
      <DropdownMenuItem onSelect={signOut} className="text-rose-600"><HugeiconsIcon icon={Logout03Icon} className="mr-2 h-4 w-4" /> Log out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function Sidebar() {
  const pinned = useSettingsStore((state) => state.sidebarPinned);
  return <aside className={cn("hidden shrink-0 transition-[width] duration-200 md:block", pinned ? "w-60" : "w-20")}>
    <div className={cn("group/rail fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden bg-sidebar px-4 py-6 transition-[width,box-shadow] duration-200", pinned ? "w-60 shadow-2xl shadow-black/20" : "w-20 hover:w-60 hover:shadow-2xl hover:shadow-black/40")} style={{ transitionTimingFunction: SNAPPY }}>
      <div className="flex items-center gap-3"><BrandMark className="h-11 w-12" /><RailLabel visible={pinned} className="text-sidebar-ink">Bijustubu</RailLabel></div>
      <div className="mt-8 min-h-0 flex-1 overflow-y-auto overflow-x-hidden"><RailLabel visible={pinned} className="mb-2 block px-3 text-[10px] uppercase tracking-[0.16em] text-sidebar-ink/35">Workspace</RailLabel><NavRows expanded={pinned} /></div>
      <div className="mt-4 border-t border-sidebar-ink/10 pt-3"><RailLabel visible={pinned} className="mb-1 block px-3 text-[10px] uppercase tracking-[0.16em] text-sidebar-ink/35">Manage</RailLabel><UtilityRows expanded={pinned} /><div className="mt-2"><ProfileMenu expanded={pinned} /></div></div>
    </div>
  </aside>;
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] md:hidden">
    <button type="button" aria-label="Close navigation" onClick={onClose} className="absolute inset-0 bg-black/40" />
    <aside className="absolute inset-y-0 left-0 flex w-72 animate-fade-in flex-col bg-sidebar p-5 shadow-2xl">
      <div className="flex items-center gap-3 px-1"><BrandMark className="h-10 w-10" /><span className="font-semibold text-sidebar-ink">Bijustubu</span></div>
      <div className="mt-8 flex-1"><NavRows expanded onNavigate={onClose} /></div>
      <div className="border-t border-sidebar-ink/10 pt-3"><UtilityRows expanded onNavigate={onClose} /><div className="mt-2"><ProfileMenu expanded onNavigate={onClose} /></div></div>
    </aside>
  </div>;
}
