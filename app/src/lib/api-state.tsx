"use client";

// The two states every screen needs once it reads from the backend:
// a failure that says what to do, and an unmissable marker when the data is
// coming from the development stub instead of a chain.

import { Details, KV } from "@/components/ui";
import { ErrorCard } from "@/components/states";
import { errorTitle, type ApiFailure } from "./api";

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
