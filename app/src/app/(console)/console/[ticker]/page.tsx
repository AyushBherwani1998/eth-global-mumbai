import { Suspense } from "react";
import type { Metadata } from "next";
import { ConsoleScreen } from "@/screens/console";
import { SkeletonList } from "@/components/states";
import { CONSOLE, getIpo } from "@/lib/mock";

/**
 * Build-time samples only (Cache Components needs at least one): the screen
 * asks the exchange server which listings exist and who may open them.
 */
export function generateStaticParams() {
  return Object.keys(CONSOLE)
    .filter((k) => getIpo(k))
    .map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: PageProps<"/console/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: `${ticker.toUpperCase()} · Issuer console` };
}

export default function ConsolePage({ params }: PageProps<"/console/[ticker]">) {
  return (
    <Suspense fallback={<SkeletonList rows={4} className="pt-6" />}>
      <ConsoleBody params={params} />
    </Suspense>
  );
}

async function ConsoleBody({ params }: { params: PageProps<"/console/[ticker]">["params"] }) {
  const { ticker } = await params;
  return <ConsoleScreen ticker={ticker} />;
}
