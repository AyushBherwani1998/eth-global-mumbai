"use client";

// One-person verification (UX.md 3.5a). Plain states only: the investor sees
// the state they are actually in. The state switcher is a demo tool and lives
// inside a collapsed "Demo" row at the bottom, never in the flow.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Details, KV, Segmented, Sheet } from "@/components/ui";
import { useApp } from "@/components/providers";
import { secondsToDuration, shortAddr } from "@/lib/format";
import { WALLET } from "@/lib/mock";

export type WorldState = "unverified" | "verifying" | "verified" | "denied" | "cancelled" | "expired";

const DEMO_STATES: { id: WorldState; label: string }[] = [
  { id: "unverified", label: "Not verified" },
  { id: "verifying", label: "Waiting" },
  { id: "verified", label: "Verified" },
  { id: "denied", label: "Already applied" },
  { id: "cancelled", label: "Cancelled" },
  { id: "expired", label: "Expired" },
];

export function WorldSheet({
  open,
  onClose,
  state,
  setState,
  company,
}: {
  open: boolean;
  onClose: () => void;
  state: WorldState;
  setState: (s: WorldState) => void;
  /** Company name, used in the verified line. */
  company: string;
}) {
  const { address } = useApp();
  const [left, setLeft] = useState(WALLET.worldId.voucherExpiresInSec);

  useEffect(() => {
    if (state !== "verified") return;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, [state]);

  const verify = () => {
    setState("verifying");
    setTimeout(() => {
      setLeft(600);
      setState("verified");
    }, 1800);
  };

  const copy: Record<WorldState, { title: string; body: string; action?: { label: string; onClick: () => void } }> = {
    unverified: {
      title: "Not verified yet",
      body: "Takes about 10 seconds in the World App.",
      action: { label: "Verify with World ID", onClick: verify },
    },
    verifying: { title: "Waiting for the World App", body: "Approve the check in the World App, then come back here." },
    verified: {
      title: `Verified for this IPO · valid ${secondsToDuration(left)}`,
      body: `You can apply for ${company}. Each person gets one application.`,
      action: { label: "Done", onClick: onClose },
    },
    denied: {
      title: "Already applied",
      body: "This person already applied for this IPO from another account. A second application isn't possible.",
      action: { label: "Close", onClick: onClose },
    },
    cancelled: {
      title: "Verification was cancelled",
      body: "You can apply after verifying.",
      action: { label: "Try again", onClick: verify },
    },
    expired: {
      title: "Your verification expired",
      body: "Verify again to apply.",
      action: { label: "Verify again", onClick: verify },
    },
  };
  const c = copy[state];

  return (
    <Sheet open={open} onClose={onClose} title="One application per person">
      <p className="t-body text-text-2">
        Each person can apply once per IPO. World ID checks that you&apos;re a real, unique person. It does not identify you and it is
        not KYC.
      </p>

      <div className="mt-4 rounded-[10px] border border-line p-4">
        <p className="t-list-title flex items-center gap-2 text-text">
          {state === "verifying" && <Loader2 className="size-4 animate-spin text-text-2" aria-hidden />}
          {c.title}
        </p>
        <p className="t-body mt-1 text-text-2">{c.body}</p>
        {c.action && (
          <Button variant={state === "verified" ? "secondary" : "buy"} size="bar" className="mt-4 w-full" onClick={c.action.onClick}>
            {c.action.label}
          </Button>
        )}
      </div>

      <Details className="mt-4">
        <div className="divide-y divide-line">
          <KV k="Uniqueness key" v={WALLET.worldId.humanKey} mono />
          <KV k="Bound account" v={shortAddr(address)} mono />
          <KV k="Sent with" v="The application itself (hookData pass)" />
        </div>
      </Details>

      <Details title="Demo" className="mt-0">
        <p className="t-caption mb-2">For the demo: jump to any state of this check.</p>
        <div className="no-scrollbar overflow-x-auto">
          <Segmented value={state} onChange={setState} label="Demo state" options={DEMO_STATES} />
        </div>
      </Details>
    </Sheet>
  );
}
