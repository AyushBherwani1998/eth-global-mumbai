"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleAlert, ExternalLink, OctagonX, Radio, ShieldCheck } from "lucide-react";
import type { Policy } from "@/lib/mock";
import { ensName } from "@/lib/mock";
import { dateTimeIST, lotFixed, shortHash, timeIST, txUrl } from "@/lib/format";
import { bandText, modeInfo, type Tone } from "@/lib/policy";
import { KV, Sheet, cx } from "./ui";

const toneStyles: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand border-brand/25",
  gain: "bg-gain-soft text-gain border-gain/25",
  warn: "bg-warn-soft text-warn border-warn/30",
  loss: "bg-loss-soft text-loss border-loss/30",
};

const ensStatusFor = (p: Policy) =>
  p.halted || p.mode === "halted" ? "halted" : p.mode === "surveillance" || p.mode === "directional" ? "surveillance" : "listed";

/** Global circuit status (screens.md §5). Animates when the mode changes. */
export function CircuitBanner({ ticker, policy, compact }: { ticker: string; policy: Policy; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const info = modeInfo(policy);
  const Icon = info.tone === "loss" ? OctagonX : info.tone === "warn" ? CircleAlert : info.tone === "gain" ? ShieldCheck : Radio;
  const prev = useRef(policy.mode + policy.halted);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const key = policy.mode + policy.halted;
    if (prev.current !== key) {
      prev.current = key;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 2500);
      return () => clearTimeout(t);
    }
  }, [policy.mode, policy.halted]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-[12px] border px-3 text-left transition-colors",
          compact ? "py-2" : "py-2.5",
          toneStyles[info.tone],
          flash && "animate-banner-flash",
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{info.copy}</span>
          <span className="block text-xs opacity-80">since {timeIST(policy.since)}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 opacity-70" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Circuit status">
        <div className={cx("rounded-[12px] border p-3", toneStyles[info.tone])}>
          <p className="font-semibold">{info.label}</p>
          <p className="text-[13px]">{info.copy}</p>
        </div>
        <div className="mt-3 divide-y divide-line">
          <KV k="Policy version" v={`v${policy.version}`} />
          <KV k="Mode" v={info.label} />
          <KV k="Reference price" v={`${lotFixed(policy.referencePrice)} USDC / lot`} />
          <KV
            k="Band"
            v={policy.halted ? "—" : policy.mode === "directional" ? "Toward reference only" : `±${policy.bandBps / 100}% · ${bandText(policy.referencePrice, policy.bandBps)}`}
          />
          <KV k="Halted" v={policy.halted ? "Yes (LP exits stay open)" : "No"} />
          {policy.coolOffMin > 0 && <KV k="Cool-off" v={`${policy.coolOffMin} min`} />}
          <KV k="Report asOf" v={dateTimeIST(policy.asOf)} />
          <KV k="Changed" v={dateTimeIST(policy.since)} />
          <KV k={`ENS ${ensName(ticker)}`} v={<code className="text-[13px]">listingday.status = {ensStatusFor(policy)}</code>} sub="Mirrored by the CRE receiver" />
        </div>
        <a
          href={txUrl(policy.creTx)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-between rounded-[12px] border border-line p-3 text-sm"
        >
          <span>
            <span className="font-semibold text-strong">CRE report tx</span>
            <span className="block font-mono text-[13px] text-muted">{shortHash(policy.creTx)}</span>
          </span>
          <ExternalLink className="size-4 text-brand" />
        </a>
        <p className="mt-2 text-xs text-muted">
          &quot;Applied&quot; is read from the receiver&apos;s own ReportProcessed event, not the tx status.
        </p>
      </Sheet>
    </>
  );
}
