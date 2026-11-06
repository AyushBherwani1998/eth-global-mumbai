"use client";

// The two states every screen needs once it reads from the backend:
// a failure that says what to do, and an unmissable marker when the data is
// coming from the development stub instead of a chain.

import { Details, KV } from "@/components/ui";
import { ErrorCard } from "@/components/states";
import { errorTitle, type ApiFailure } from "./api";
import { useHealth } from "./live";

/**
 * Plain English, the fix in the sentence, Retry. The server's own wording and
 * the code live inside the collapsed Details, per the house rule on protocol
 * words.
 */
export function ApiErrorCard({
  error,
  onRetry,
  retrying,
  className,
}: {
  error: ApiFailure;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <ErrorCard title={errorTitle(error)} body={error.sentence} onRetry={error.retryable ? onRetry : undefined} retrying={retrying} />
      {(error.serverMessage || error.status) && (
        <Details className="mt-2" title="Details">
          <div className="divide-y divide-line">
            <KV k="Code" v={error.code} mono />
            {error.status !== null && <KV k="HTTP status" v={String(error.status)} mono />}
            {error.serverMessage && <KV k="Server said" v={error.serverMessage} mono />}
          </div>
        </Details>
      )}
    </div>
  );
}

/**
 * "Demo data" while the app is pointed at app/dev/api-stub instead of a chain.
 * The stub's /health answers `stub://fixtures`; a real backend answers with an
 * RPC host, and this renders nothing. Grey strip, no tint, no icon.
 */
export function DemoDataStrip({ className }: { className?: string }) {
  const { data } = useHealth();
  const isStub = typeof data?.rpc === "string" && data.rpc.startsWith("stub://");
  if (!isStub) return null;
  return (
    <div role="status" className={`flex min-h-12 items-center border-y border-line-strong bg-surface-2 px-5 py-2 ${className ?? ""}`}>
      <p className="t-body text-text">
        <span className="font-medium">Demo data.</span> These numbers come from a local test server, not from a live chain. Nothing here is real.
      </p>
    </div>
  );
}
