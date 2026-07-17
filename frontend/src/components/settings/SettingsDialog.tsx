import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ComputerIcon,
  CreditCardIcon,
  LockPasswordIcon,
  Moon02Icon,
  Notification03Icon,
  PaintBoardIcon,
  SidebarLeft01Icon,
  Sun01Icon,
  Tick02Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { changePassword, updateProfile } from "@/api/auth";
import { getOverview } from "@/api/overview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { APP_THEMES } from "@/lib/themes";
import type { ThemeMode } from "@/lib/themes";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";

/**
 * ChatGPT-style settings modal: left section rail, right scrollable content.
 * Opened from anywhere via the `?settings=<section>` URL param (AppLayout owns
 * the param plumbing); the legacy /settings route redirects into it.
 */
export const SETTINGS_SECTIONS = ["account", "plan", "appearance", "notifications"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SECTION_META: { id: SettingsSection; label: string; icon: typeof UserCircleIcon }[] = [
  { id: "account", label: "Account", icon: UserCircleIcon },
  { id: "plan", label: "Plan", icon: CreditCardIcon },
  { id: "appearance", label: "Appearance", icon: PaintBoardIcon },
  { id: "notifications", label: "Notifications", icon: Notification03Icon },
];

interface SettingsDialogProps {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, section, onSectionChange, onClose }: SettingsDialogProps) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-describedby={undefined} hideClose className="h-[min(40rem,calc(100dvh-3rem))] w-full max-w-3xl gap-0 overflow-hidden p-0">
        {/* Own close button: the built-in × sits inside the p-6 content flow
            and collides with the cards in this p-0 two-column layout. */}
        <DialogClose className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border-soft bg-surface text-ink-muted shadow-sm transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50">
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
          <span className="sr-only">Close</span>
        </DialogClose>
        <div className="flex h-full min-h-0 flex-col sm:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-border-soft p-3 sm:w-52 sm:border-b-0 sm:border-r">
            <DialogTitle className="px-3 pb-2.5 pt-1.5 text-base">Settings</DialogTitle>
            <nav className="flex gap-1 overflow-x-auto pr-8 sm:flex-col sm:overflow-visible sm:pr-0">
              {SECTION_META.map(({ id, label, icon }) => {
                const active = id === section;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSectionChange(id)}
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-surface-muted text-ink" : "text-ink-muted hover:bg-surface-muted/60 hover:text-ink",
                    )}
                  >
                    <HugeiconsIcon icon={icon} size={16} className="shrink-0" />
                    {label}
                  </button>
                );
              })}
            </nav>
          </aside>
          <div className={cn("min-h-0 flex-1 overflow-y-auto p-5 sm:p-6", THIN_SCROLLBAR_CLASS)}>
            {section === "account" && <AccountSection />}
            {section === "plan" && <PlanSection onUpgrade={() => { onClose(); navigate("/pricing"); }} />}
            {section === "appearance" && <AppearanceSection />}
            {section === "notifications" && <NotificationsSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SwitchRow({ checked, onChange, title, description, icon }: { checked: boolean; onChange: () => void; title: string; description: string; icon: typeof SidebarLeft01Icon }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={onChange} className="flex w-full items-center gap-4 rounded-2xl border border-border-soft px-4 py-4 text-left transition-colors hover:bg-surface-muted">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-ink"><HugeiconsIcon icon={icon} size={20} /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink-muted">{description}</span></span>
    <span aria-hidden className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-sidebar" : "bg-border-soft")}><span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-5")} /></span>
  </button>;
}

function AccountSection() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [displayName, setDisplayName] = useState(user?.displayName || user?.email?.split("@")[0] || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const usageQuery = useQuery({ queryKey: ["overview"], queryFn: getOverview });

  const profileMutation = useMutation({
    mutationFn: () => updateProfile(displayName.trim()),
    onSuccess: ({ user: nextUser }) => setUser(nextUser),
  });
  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setPasswordMessage("Password updated successfully."); },
    onError: (error) => setPasswordMessage(isAxiosError(error) && error.response?.data?.error === "invalid_current_password" ? "Current password is incorrect." : "Could not update password."),
  });

  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>Profile</CardTitle><CardDescription>Your identity across this workspace.</CardDescription></CardHeader><CardContent className="space-y-4 pt-0">
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="account-email">Email</Label><Input id="account-email" value={user?.email ?? ""} disabled /></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-muted">Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</p><Button size="sm" onClick={() => profileMutation.mutate()} disabled={!displayName.trim() || profileMutation.isPending}>{profileMutation.isPending ? "Saving…" : profileMutation.isSuccess ? "Saved" : "Save profile"}</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Security</CardTitle><CardDescription>Use at least 8 characters for your new password.</CardDescription></CardHeader><CardContent className="space-y-4 pt-0">
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3">{passwordMessage ? <p className={cn("text-xs", passwordMessage.includes("successfully") ? "text-emerald-600" : "text-rose-600")}>{passwordMessage}</p> : <span />}<Button size="sm" onClick={() => passwordMutation.mutate()} disabled={currentPassword.length < 8 || newPassword.length < 8 || passwordMutation.isPending}><HugeiconsIcon icon={LockPasswordIcon} className="h-4 w-4" />Update password</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Workspace usage</CardTitle><CardDescription>A compact summary of data attached to this account.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-3">
      {[
        ["Collections", usageQuery.data?.metrics.collections],
        ["Rows", usageQuery.data?.metrics.rows],
        ["Relations", usageQuery.data?.metrics.relations],
        ["Dashboards", usageQuery.data?.metrics.dashboards],
        ["Knowledge", usageQuery.data?.metrics.knowledgeDocuments],
      ].map(([label, value]) => <div key={label} className="rounded-2xl bg-surface-muted p-4"><p className="text-[11px] text-ink-muted">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{usageQuery.isLoading ? "…" : typeof value === "number" ? value.toLocaleString() : "—"}</p></div>)}
    </CardContent></Card>
  </div>;
}

/** Placeholder monetization surface — no billing backend exists yet. */
const PLAN_LIMITS = [
  { key: "collections", label: "Collections", limit: 20 },
  { key: "dashboards", label: "Dashboards", limit: 10 },
  { key: "knowledgeDocuments", label: "Knowledge documents", limit: 25 },
] as const;

function PlanSection({ onUpgrade }: { onUpgrade: () => void }) {
  // Usage must be current when this section opens; the Overview cache may be fresh but stale after a background import/sync.
  const usageQuery = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchOnMount: "always" });
  const metrics = usageQuery.data?.metrics;

  return <div className="space-y-5">
    <Card><CardHeader>
      <div className="flex items-center gap-2"><CardTitle>Current plan</CardTitle><span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink">Free</span></div>
      <CardDescription>Everything you need to explore your own data. Upgrade for higher limits and team features.</CardDescription>
    </CardHeader><CardContent className="space-y-3 pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">Billing isn't wired up yet — this is a preview of the plan system.</p>
        <Button size="sm" onClick={onUpgrade}><HugeiconsIcon icon={CreditCardIcon} className="h-4 w-4" />See plans &amp; upgrade</Button>
      </div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Usage</CardTitle><CardDescription>How much of the Free plan this workspace is using.</CardDescription></CardHeader><CardContent className="space-y-4 pt-0">
      {PLAN_LIMITS.map(({ key, label, limit }) => {
        const used = metrics?.[key] ?? 0;
        const pct = Math.min(100, Math.round((used / limit) * 100));
        return <div key={key}>
          <div className="flex items-baseline justify-between text-xs"><span className="font-medium text-ink">{label}</span><span className="tabular-nums text-ink-muted">{usageQuery.isLoading ? "…" : `${used.toLocaleString()} / ${limit}`}</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className={cn("h-full rounded-full transition-[width] duration-500", pct >= 90 ? "bg-rose-500" : "bg-accent-blue")} style={{ width: `${pct}%` }} /></div>
        </div>;
      })}
    </CardContent></Card>
  </div>;
}

function AppearanceSection() {
  const settings = useSettingsStore();
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>Mode</CardTitle><CardDescription>Light, dark, or follow your device.</CardDescription></CardHeader><CardContent className="pt-0"><div className="grid grid-cols-3 gap-3 sm:max-w-md">{([
      { mode: "light" as ThemeMode, label: "Light", icon: Sun01Icon },
      { mode: "dark" as ThemeMode, label: "Dark", icon: Moon02Icon },
      { mode: "system" as ThemeMode, label: "System", icon: ComputerIcon },
    ]).map(({ mode, label, icon }) => { const active = settings.mode === mode; return <button key={mode} type="button" onClick={() => settings.setMode(mode)} aria-pressed={active} className={cn("flex flex-col items-center gap-1.5 rounded-2xl border px-4 py-3.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-card", active ? "border-transparent bg-surface-muted text-ink ring-2 ring-accent-blue" : "border-border-soft text-ink-muted")}><HugeiconsIcon icon={icon} className="h-4.5 w-4.5" />{label}</button>; })}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>Theme</CardTitle><CardDescription>Primary color used across navigation, actions, and chat.</CardDescription></CardHeader><CardContent className="pt-0"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{APP_THEMES.map((theme) => { const active = theme.id === settings.themeId; return <button key={theme.id} type="button" onClick={() => settings.setTheme(theme.id)} className={cn("group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-card", active ? "border-transparent ring-2 ring-accent-blue" : "border-border-soft")}><span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-inner" style={{ background: `linear-gradient(135deg, ${theme.primary} 60%, ${theme.accent} 60%)` }}>{active && <HugeiconsIcon icon={Tick02Icon} className="h-4 w-4" style={{ color: theme.ink }} />}</span><span className="truncate text-sm font-medium text-ink">{theme.label}</span></button>; })}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>Layout</CardTitle><CardDescription>Choose how navigation behaves on desktop.</CardDescription></CardHeader><CardContent className="pt-0"><SwitchRow checked={settings.sidebarPinned} onChange={() => settings.setSidebarPinned(!settings.sidebarPinned)} title="Keep sidebar expanded" description="Always show navigation labels without hovering." icon={SidebarLeft01Icon} /></CardContent></Card>
  </div>;
}

function NotificationsSection() {
  const settings = useSettingsStore();
  return <Card><CardHeader><CardTitle>Job notifications</CardTitle><CardDescription>Choose which completed background jobs appear in the notification bell.</CardDescription></CardHeader><CardContent className="space-y-3 pt-0"><SwitchRow checked={settings.notifySuccess} onChange={() => settings.setNotifySuccess(!settings.notifySuccess)} title="Successful jobs" description="Dashboard, knowledge, upload, and insight completions." icon={Notification03Icon} /><SwitchRow checked={settings.notifyFailure} onChange={() => settings.setNotifyFailure(!settings.notifyFailure)} title="Failed jobs" description="Show failures that may need your attention." icon={Notification03Icon} /></CardContent></Card>;
}
