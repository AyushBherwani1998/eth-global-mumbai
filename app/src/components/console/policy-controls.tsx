"use client";

import { useState } from "react";
import { Button, Card, KV } from "@/components/ui";
import { useWalletSession } from "@/components/wallet/session";
import { API_URL } from "@/lib/api";
import type { PolicyView } from "./policy";

type PolicyOperation = "halt" | "resume" | "set_mode" | "set_reference";
type PolicyMode = "normal" | "surveillance" | "directional";

export function PolicyControls({ ticker, policy }: { ticker: string; policy: PolicyView | null }) {
  const wallet = useWalletSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<PolicyMode>("normal");
  const [referencePrice, setReferencePrice] = useState<string>("");

  const executeOperation = async (operation: PolicyOperation, params: Record<string, unknown> = {}) => {
    if (!wallet.connected || !wallet.address) {
      setError("Please connect your wallet first");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setSuccess(null);

      const timestamp = Math.floor(Date.now() / 1000);
      const chainId = 11155111; // Sepolia
      const domain = "listing-day.api";
      const nonce = `${timestamp}_${Math.random().toString(36).slice(2)}`;

      const payload = {
        operation,
        ...params,
      };

      const payloadJson = JSON.stringify(payload);
      const message = JSON.stringify({
        domain,
        action: "relay_policy",
        chainId,
        timestamp,
        nonce,
        ticker,
        payloadHash: "0x" + Array.from(new TextEncoder().encode(payloadJson))
          .map(b => b.toString(16).padStart(2, '0')).join(''),
      });

      // Sign message with wallet
      // @ts-expect-error - wallet.signMessage exists in Privy
      const signature = await wallet.signMessage(message);

      // Send signed request to API
      const response = await fetch(`${API_URL}/v1/policy/${ticker}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          action: "relay_policy",
          chainId,
          timestamp,
          nonce,
          ticker,
          payload,
          signature,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Failed to relay policy");
      }

      const result = await response.json();
      
      if (result.success) {
        setSuccess(`Policy ${operation} executed successfully!`);
      } else {
        setError(result.error || result.warning || "Operation failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to execute operation");
    } finally {
      setBusy(false);
    }
  };

  const handleHalt = () => executeOperation("halt", { halted: true });
  const handleResume = () => executeOperation("resume", { halted: false });
  const handleSetMode = () => executeOperation("set_mode", { mode: selectedMode });
  const handleSetReference = () => {
    if (!referencePrice || !/^\d+(\.\d+)?$/.test(referencePrice)) {
      setError("Please enter a valid reference price");
      return;
    }
    executeOperation("set_reference", { referencePrice });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="t-list-title text-text mb-3">Demo Policy Controls</h3>
        <p className="t-label mb-4 text-text-2">
          Manual operator controls for demonstration. These use server-side relaying through the existing mock forwarder.
          <strong className="block mt-1 text-text">Demo/Manual Operator Report - NOT real CRE execution</strong>
        </p>

        {policy && (
          <div className="mb-4 p-3 bg-surface-2 rounded border border-line">
            <div className="divide-y divide-line">
              <KV k="Current Status" v={policy.halted ? "HALTED" : "Active"} />
              <KV k="Mode" v={policy.mode} />
              {policy.referencePrice !== null && (
                <KV k="Reference Price" v={`${policy.referencePrice} points`} />
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {/* Halt / Resume */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleHalt}
              busy={busy}
              disabled={policy?.halted === true}
              className="flex-1"
            >
              🛑 Full Halt
            </Button>
            <Button
              variant="secondary"
              onClick={handleResume}
              busy={busy}
              disabled={policy?.halted === false}
              className="flex-1"
            >
              ✅ Resume
            </Button>
          </div>

          {/* Mode Selection */}
          <div>
            <label className="t-label block mb-2">Trading Mode:</label>
            <div className="flex gap-2 mb-2">
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value as PolicyMode)}
                className="flex-1 px-3 py-2 border border-line rounded bg-surface text-text"
                disabled={busy}
              >
                <option value="normal">Normal (20% bands)</option>
                <option value="surveillance">Under Watch (5% bands)</option>
                <option value="directional">Directional / One-way Day</option>
              </select>
              <Button onClick={handleSetMode} busy={busy} disabled={!selectedMode}>
                Set Mode
              </Button>
            </div>
            <p className="t-caption text-text-2">
              {selectedMode === "normal" && "Trades within 20% of reference price"}
              {selectedMode === "surveillance" && "Trades within 5% of reference price"}
              {selectedMode === "directional" && "Narrowing price/reference gap succeeds, widening reverts"}
            </p>
          </div>

          {/* Reference Price */}
          <div>
            <label className="t-label block mb-2">Reference Price (points):</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={referencePrice}
                onChange={(e) => setReferencePrice(e.target.value)}
                placeholder="100.00"
                className="flex-1 px-3 py-2 border border-line rounded bg-surface text-text"
                disabled={busy}
              />
              <Button onClick={handleSetReference} busy={busy} disabled={!referencePrice}>
                Set Reference
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-loss-bg border border-loss-border rounded">
            <p className="t-body text-loss-text">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-gain-bg border border-gain-border rounded">
            <p className="t-body text-gain-text">{success}</p>
          </div>
        )}

        <div className="mt-4 p-3 bg-surface-2 border border-line rounded">
          <p className="t-caption text-text-2">
            <strong>Note:</strong> Browser-based policy relay is for demonstration only. The RELAYER_PRIVATE_KEY must be configured in Railway environment variables. For production use, rely on the command-line CRE workflow.
          </p>
        </div>
      </Card>

      {/* Directional Halt Demonstration */}
      <Card className="p-4">
        <h3 className="t-list-title text-text mb-3">Directional Halt Demonstration</h3>
        <p className="t-label mb-3 text-text-2">
          Demonstrates directional mode behavior where narrowing the price/reference gap succeeds and widening reverts with DirectionalWidening error.
        </p>

        <div className="space-y-2 text-text-2 t-body">
          <p>• <strong>Full Halt:</strong> Blocks all trades in both directions</p>
          <p>• <strong>Directional Mode:</strong> Price moving toward reference ✅ | Price moving away ❌ DirectionalWidening</p>
          <p>• <strong>At Reference:</strong> Small moves in either direction may succeed (within tolerance)</p>
        </div>

        <div className="mt-3 p-3 bg-surface-2 border border-line rounded">
          <p className="t-caption text-text">
            To test directionally: Set mode to "directional", then attempt trades that move price toward and away from reference. Use the Quote/Simulate functionality to preview without broadcasting.
          </p>
        </div>
      </Card>
    </div>
  );
}
