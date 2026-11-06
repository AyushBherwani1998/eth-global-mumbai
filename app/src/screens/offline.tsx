"use client";

// Cold offline open (UX.md section 5): the service worker serves this page when
// the network is gone and nothing else is cached.

import { Logo } from "@/components/shell";
import { Button } from "@/components/ui";

export function OfflineScreen() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col justify-center px-5 py-10">
      <Logo size={48} />
      <h1 className="t-page-title mt-6">You&apos;re offline</h1>
      <p className="t-body mt-2 text-text-2">
        Reconnect to see prices. Buying, selling and applying need a connection, so they are turned off until you are back.
      </p>
      <Button className="mt-6 w-full sm:w-auto sm:self-start" onClick={() => location.reload()}>
        Try again
      </Button>
      <p className="t-caption mt-6">thaamba · NSE-inspired mock, not a regulated product.</p>
    </main>
  );
}
