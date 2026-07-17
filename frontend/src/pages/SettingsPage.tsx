import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { HugeiconsIcon } from "@hugeicons/react";
import { ComputerIcon, LockPasswordIcon, Moon02Icon, Notification03Icon, SidebarLeft01Icon, Sun01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { changePassword, updateProfile } from "@/api/auth";
import { getOverview } from "@/api/overview";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { APP_THEMES } from "@/lib/themes";
import type { ThemeMode } from "@/lib/themes";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";

function SwitchRow({ checked, onChange, title, description, icon }: { checked: boolean; onChange: () => void; title: string; description: string; icon: typeof SidebarLeft01Icon }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={onChange} className="flex w-full items-center gap-4 rounded-2xl border border-border-soft px-4 py-4 text-left transition-colors hover:bg-surface-muted">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-ink"><HugeiconsIcon icon={icon} size={20} /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink-muted">{description}</span></span>
    <span aria-hidden className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-sidebar" : "bg-border-soft")}><span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-5")} /></span>
  </button>;
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const section = ["account", "appearance", "notifications"].includes(params.get("section") ?? "") ? params.get("section")! : "account";
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const settings = useSettingsStore();
  const [displayName, setDisplayName] = useState(user?.displayName || user?.email?.split("@")[0] || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const usageQuery = useQuery({
    queryKey: ["overview"],
    queryFn: getOverview,
    enabled: section === "account",
  });

  const profileMutation = useMutation({
    mutationFn: () => updateProfile(displayName.trim()),
    onSuccess: ({ user: nextUser }) => setUser(nextUser),
  });
  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setPasswordMessage("Password updated successfully."); },
    onError: (error) => setPasswordMessage(isAxiosError(error) && error.response?.data?.error === "invalid_current_password" ? "Current password is incorrect." : "Could not update password."),
  });

  return <div>
    <TopBar title="Settings" />
    <Tabs value={section} onValueChange={(value) => setParams({ section: value }, { replace: true })}>
      <TabsList className="mb-5 max-w-full overflow-x-auto">
        <TabsTrigger value="account">Account</TabsTrigger><TabsTrigger value="appearance">Appearance</TabsTrigger><TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>

      <TabsContent value="account" className="mt-0 space-y-6">
        <Card><CardHeader><CardTitle>Profile</CardTitle><CardDescription>Your identity across this workspace.</CardDescription></CardHeader><CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="account-email">Email</Label><Input id="account-email" value={user?.email ?? ""} disabled /></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-muted">Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</p><Button size="sm" onClick={() => profileMutation.mutate()} disabled={!displayName.trim() || profileMutation.isPending}>{profileMutation.isPending ? "Saving…" : profileMutation.isSuccess ? "Saved" : "Save profile"}</Button></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Security</CardTitle><CardDescription>Use at least 8 characters for your new password.</CardDescription></CardHeader><CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3">{passwordMessage ? <p className={cn("text-xs", passwordMessage.includes("successfully") ? "text-emerald-600" : "text-rose-600")}>{passwordMessage}</p> : <span />}<Button size="sm" onClick={() => passwordMutation.mutate()} disabled={currentPassword.length < 8 || newPassword.length < 8 || passwordMutation.isPending}><HugeiconsIcon icon={LockPasswordIcon} className="h-4 w-4" />Update password</Button></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Workspace usage</CardTitle><CardDescription>A compact summary of data attached to this account.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-5">
          {[
            ["Collections", usageQuery.data?.metrics.collections],
            ["Rows", usageQuery.data?.metrics.rows],
            ["Relations", usageQuery.data?.metrics.relations],
            ["Dashboards", usageQuery.data?.metrics.dashboards],
            ["Knowledge", usageQuery.data?.metrics.knowledgeDocuments],
          ].map(([label, value]) => <div key={label} className="rounded-2xl bg-surface-muted p-4"><p className="text-[11px] text-ink-muted">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{usageQuery.isLoading ? "…" : typeof value === "number" ? value.toLocaleString() : "—"}</p></div>)}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="appearance" className="mt-0 space-y-6">
        <Card><CardHeader><CardTitle>Mode</CardTitle><CardDescription>Light, dark, or follow your device.</CardDescription></CardHeader><CardContent className="pt-0"><div className="grid grid-cols-3 gap-3 sm:max-w-md">{([
          { mode: "light" as ThemeMode, label: "Light", icon: Sun01Icon },
          { mode: "dark" as ThemeMode, label: "Dark", icon: Moon02Icon },
          { mode: "system" as ThemeMode, label: "System", icon: ComputerIcon },
        ]).map(({ mode, label, icon }) => { const active = settings.mode === mode; return <button key={mode} type="button" onClick={() => settings.setMode(mode)} aria-pressed={active} className={cn("flex flex-col items-center gap-1.5 rounded-2xl border px-4 py-3.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-card", active ? "border-transparent bg-surface-muted text-ink ring-2 ring-accent-blue" : "border-border-soft text-ink-muted")}><HugeiconsIcon icon={icon} className="h-4.5 w-4.5" />{label}</button>; })}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Theme</CardTitle><CardDescription>Primary color used across navigation, actions, and chat.</CardDescription></CardHeader><CardContent className="pt-0"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{APP_THEMES.map((theme) => { const active = theme.id === settings.themeId; return <button key={theme.id} type="button" onClick={() => settings.setTheme(theme.id)} className={cn("group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-card", active ? "border-transparent ring-2 ring-accent-blue" : "border-border-soft")}><span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-inner" style={{ background: `linear-gradient(135deg, ${theme.primary} 60%, ${theme.accent} 60%)` }}>{active && <HugeiconsIcon icon={Tick02Icon} className="h-4 w-4" style={{ color: theme.ink }} />}</span><span className="truncate text-sm font-medium text-ink">{theme.label}</span></button>; })}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Layout</CardTitle><CardDescription>Choose how navigation behaves on desktop.</CardDescription></CardHeader><CardContent className="pt-0"><SwitchRow checked={settings.sidebarPinned} onChange={() => settings.setSidebarPinned(!settings.sidebarPinned)} title="Keep sidebar expanded" description="Always show navigation labels without hovering." icon={SidebarLeft01Icon} /></CardContent></Card>
      </TabsContent>

      <TabsContent value="notifications" className="mt-0">
        <Card><CardHeader><CardTitle>Job notifications</CardTitle><CardDescription>Choose which completed background jobs appear in the notification bell.</CardDescription></CardHeader><CardContent className="space-y-3 pt-0"><SwitchRow checked={settings.notifySuccess} onChange={() => settings.setNotifySuccess(!settings.notifySuccess)} title="Successful jobs" description="Dashboard, knowledge, upload, and insight completions." icon={Notification03Icon} /><SwitchRow checked={settings.notifyFailure} onChange={() => settings.setNotifyFailure(!settings.notifyFailure)} title="Failed jobs" description="Show failures that may need your attention." icon={Notification03Icon} /></CardContent></Card>
      </TabsContent>
    </Tabs>
  </div>;
}
