import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Placeholder monetization page — pure UI, no billing backend. Prices and
 * limits here are illustrative; the Plan settings section links to this page.
 */
type Billing = "monthly" | "yearly";

interface PlanDef {
  id: string;
  name: string;
  blurb: string;
  monthly: number;
  highlight?: boolean;
  cta: string;
  features: string[];
}

const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    blurb: "For personal exploration.",
    monthly: 0,
    cta: "Current plan",
    features: [
      "20 collections · 10 dashboards",
      "25 knowledge documents",
      "AI dashboard generation with cooldowns",
      "CSV, Excel, PDF, DOCX, TXT & SQL import",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    blurb: "For serious personal workspaces.",
    monthly: 12,
    highlight: true,
    cta: "Coming soon",
    features: [
      "Unlimited collections & dashboards",
      "500 knowledge documents",
      "Shorter AI cooldowns & priority queue",
      "Scheduled exports & API access",
    ],
  },
  {
    id: "team",
    name: "Team",
    blurb: "For small teams sharing data.",
    monthly: 29,
    cta: "Coming soon",
    features: [
      "Everything in Pro",
      "Shared workspaces & roles",
      "Audit log retention (1 year)",
      "SSO & admin controls",
    ],
  },
];

const YEARLY_DISCOUNT = 0.8;

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div>
      <TopBar title="Pricing" />

      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Simple plans for every workspace</h2>
        <p className="text-sm text-ink-muted">
          Payments aren't wired up yet, this page previews the plan lineup.
        </p>
        <div className="mt-2 flex items-center rounded-full border border-border-soft bg-surface p-1 text-sm font-medium">
          {(["monthly", "yearly"] as Billing[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setBilling(option)}
              aria-pressed={billing === option}
              className={cn(
                "rounded-full px-4 py-1.5 transition-colors",
                billing === option ? "bg-sidebar text-sidebar-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {option === "monthly" ? "Monthly" : <span>Yearly <span className={cn("text-xs", billing === option ? "opacity-80" : "text-emerald-600")}>−20%</span></span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-5xl gap-5 md:grid-cols-3">
        {PLANS.map((plan) => {
          const price = billing === "yearly" ? plan.monthly * YEARLY_DISCOUNT : plan.monthly;
          const isFree = plan.monthly === 0;
          return (
            <Card key={plan.id} className={cn("relative flex flex-col", plan.highlight && "ring-2 ring-accent-blue")}>
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-blue px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}
              <CardContent className="flex flex-1 flex-col gap-5 p-6">
                <div>
                  <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
                  <p className="mt-0.5 text-sm text-ink-muted">{plan.blurb}</p>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tabular-nums text-ink">
                    {isFree ? "$0" : `$${price % 1 === 0 ? price : price.toFixed(2)}`}
                  </span>
                  <span className="text-sm text-ink-muted">/ month</span>
                  {!isFree && billing === "yearly" && (
                    <span className="text-xs text-ink-muted line-through">${plan.monthly}</span>
                  )}
                </div>
                <ul className="flex flex-1 flex-col gap-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-ink">
                      <HugeiconsIcon icon={Tick02Icon} className="mt-0.5 h-4 w-4 shrink-0 text-accent-blue" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant={plan.highlight ? "default" : "outline"} disabled className="w-full">
                  {plan.cta}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-ink-muted">
        Questions about plans? Billing integration is on the roadmap, nothing is charged today.
      </p>
    </div>
  );
}
