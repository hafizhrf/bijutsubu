import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Loading03Icon,
  Mail01Icon,
  SquareLock02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { BrandMark } from "@/components/layout/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthFormCardProps {
  title: string;
  description: string;
  submitLabel: string;
  busyLabel: string;
  isSubmitting: boolean;
  error: string | null;
  email: string;
  onEmailChange: (email: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  passwordAutoComplete: "current-password" | "new-password";
  passwordMinLength?: number;
  passwordHint?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  footer: ReactNode;
}

/**
 * The auth form panel shared by the login and register pages: brand mark,
 * icon-leading fields with a password visibility toggle, styled error alert,
 * and an ambient accent glow behind the card. Pages own state + submit logic.
 */
export function AuthFormCard({
  title,
  description,
  submitLabel,
  busyLabel,
  isSubmitting,
  error,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  passwordAutoComplete,
  passwordMinLength,
  passwordHint,
  onSubmit,
  footer,
}: AuthFormCardProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative w-full max-w-md animate-fade-in-up 2xl:max-w-lg">
      <div className="relative rounded-3xl border border-border-soft bg-surface p-8 shadow-[0_28px_80px_-28px_rgba(0,0,0,0.55)] sm:p-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="h-12 w-12 bg-ink" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
            <p className="mt-1.5 text-sm text-ink-muted">{description}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <HugeiconsIcon
                icon={Mail01Icon}
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="you@example.com"
                className="pl-11"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <HugeiconsIcon
                icon={SquareLock02Icon}
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={passwordAutoComplete}
                required
                minLength={passwordMinLength}
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="••••••••"
                className="pl-11 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((show) => !show)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <HugeiconsIcon icon={showPassword ? ViewOffSlashIcon : ViewIcon} size={16} />
              </button>
            </div>
            {passwordHint && <p className="text-xs text-ink-muted">{passwordHint}</p>}
          </div>

          {error && (
            <div className="flex animate-fade-in items-start gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <HugeiconsIcon icon={AlertCircleIcon} size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" className="mt-2 h-11 w-full" disabled={isSubmitting}>
            {isSubmitting && (
              <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
            )}
            {isSubmitting ? busyLabel : submitLabel}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">{footer}</p>
      </div>
    </div>
  );
}
