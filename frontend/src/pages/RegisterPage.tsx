import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { playBrandTransition } from "@/components/layout/BrandTransition";

export default function RegisterPage() {
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
      const { token, user } = await register(email, password);
      setAuth(token, user);
      playBrandTransition(() => navigate("/overview"));
    } catch {
      setError("Could not create your account. Please try again.");
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
          title="Create your account"
          description="Start building with Bijustubu"
          submitLabel="Create account"
          busyLabel="Creating account…"
          isSubmitting={isSubmitting}
          error={error}
          email={email}
          onEmailChange={setEmail}
          password={password}
          onPasswordChange={setPassword}
          passwordAutoComplete="new-password"
          passwordMinLength={8}
          passwordHint="Use at least 8 characters."
          onSubmit={handleSubmit}
          footer={
            <>
              Already have an account?{" "}
              <Link to="/login" className="font-medium text-accent-blue hover:underline">
                Sign in
              </Link>
            </>
          }
        />
      </main>
    </div>
  );
}
