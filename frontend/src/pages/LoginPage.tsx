import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { playBrandTransition } from "@/components/layout/BrandTransition";
import { isAxiosError } from "axios";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { token, user } = await login(email, password);
      setAuth(token, user);
      playBrandTransition(() => navigate("/overview"));
    } catch (error) {
      setError(isAxiosError(error) && error.response?.data?.error === "account_suspended" ? "This account has been suspended. Contact your workspace administrator." : "Could not sign in. Check your credentials and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <AuthShowcase />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 lg:flex-none lg:w-[32rem] xl:w-[36rem] 2xl:w-[42rem]">
        {/* React Flow-style dot grid, faded toward the edges. Dot color derives
            from the ink token so it adapts to light/dark automatically. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-dots-breathe bg-[radial-gradient(color-mix(in_srgb,var(--color-ink)_16%,transparent)_1.5px,transparent_1.5px)] bg-center [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]"
        />
        <AuthFormCard
          title="Welcome back"
          description="Sign in to your Bijustubu workspace"
          submitLabel="Sign in"
          busyLabel="Signing in…"
          isSubmitting={isSubmitting}
          error={error}
          email={email}
          onEmailChange={setEmail}
          password={password}
          onPasswordChange={setPassword}
          passwordAutoComplete="current-password"
          onSubmit={handleSubmit}
          footer={
            <>
              Don&apos;t have an account?{" "}
              <Link to="/register" className="font-medium text-accent-blue hover:underline">
                Create one
              </Link>
            </>
          }
        />
      </main>
    </div>
  );
}
