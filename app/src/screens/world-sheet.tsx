"use client";

import { useEffect, useState } from "react";
import { CircleSlash, Clock, Loader2, ScanFace, ShieldCheck, UserX } from "lucide-react";
import { Button, KV, Segmented, Sheet } from "@/components/ui";
import { useApp } from "@/components/providers";
import { secondsToDuration, shortAddr } from "@/lib/format";
import { WALLET } from "@/lib/mock";

export type WorldState = "unverified" | "verifying" | "verified" | "denied" | "cancelled" | "expired";

/** World verify sheet (screens.md §2a). States are switchable for review. */
export function WorldSheet({
  open,
  onClose,
  state,
  setState,
  symbol,
}: {
  open: boolean;
  onClose: () => void;
  state: WorldState;
  setState: (s: WorldState) => void;
  symbol: string;
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

  return (
    <Sheet open={open} onClose={onClose} title="One applicant check">
      <p className="text-sm text-muted">
        Each person can apply once per IPO. World ID proves you&apos;re a unique human. Only your uniqueness is checked;
        this is not KYC.
      </p>

      <div className="mt-4 rounded-[12px] border border-line p-4">
        {state === "unverified" && (
          <Body icon={<ScanFace className="size-6 text-brand" />} title="Not verified yet" body="Takes about 10 seconds in World App.">
            <Button tone="neutral" className="mt-3 w-full" onClick={verify}>
              Verify with World ID
            </Button>
          </Body>
        )}
        {state === "verifying" && (
          <Body icon={<Loader2 className="size-6 animate-spin text-brand" />} title="Waiting for World…" body="Approve the request in World App, then come back here." />
        )}
        {state === "verified" && (
          <Body
            icon={<ShieldCheck className="size-6 text-gain" />}
            title={`Verified · pass expires in ${secondsToDuration(left)}`}
            body={`Verified: one application per person for ${symbol}.`}
          >
            <div className="mt-2 divide-y divide-line">
              <KV k="Human key" v={WALLET.worldId.humanKey} />
              <KV k="Bound wallet" v={shortAddr(address)} />
            </div>
          </Body>
        )}
        {state === "denied" && (
          <Body
            icon={<UserX className="size-6 text-loss" />}
            title="Already applied"
            body={`This person already applied with 0xAB…CD for ${symbol}. No pass was issued, so bidding stays off.`}
          />
        )}
        {state === "cancelled" && (
          <Body icon={<CircleSlash className="size-6 text-muted" />} title="Verification cancelled" body="Bidding stays off until you verify.">
            <Button tone="neutral" variant="outline" className="mt-3 w-full" onClick={verify}>
              Retry
            </Button>
          </Body>
        )}
        {state === "expired" && (
          <Body icon={<Clock className="size-6 text-warn" />} title="Pass expired" body="Passes last 10 minutes. Verify again to bid.">
            <Button tone="neutral" variant="outline" className="mt-3 w-full" onClick={verify}>
              Re-verify
            </Button>
          </Body>
        )}
      </div>

      <div className="mt-4 rounded-[12px] bg-subtle p-3">
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Preview state (mock)</p>
        <div className="no-scrollbar overflow-x-auto">
          <Segmented
            size="sm"
            value={state}
            onChange={setState}
            options={(["unverified", "verifying", "verified", "denied", "cancelled", "expired"] as WorldState[]).map((s) => ({ id: s, label: s }))}
          />
        </div>
      </div>
    </Sheet>
  );
}

function Body({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="font-semibold text-strong">{title}</p>
          <p className="text-[13px] text-muted">{body}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
