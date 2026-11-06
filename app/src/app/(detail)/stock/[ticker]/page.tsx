import { Suspense } from "react";
import type { Metadata } from "next";
import { CompanyScreen } from "@/screens/company";
import { SkeletonChart } from "@/components/states";
import { TICKERS } from "@/lib/mock";

/**
 * Build-time samples only, not a claim about which companies exist: the page
 * itself asks the backend for that at runtime, and any other ticker renders on
 * demand. Cache Components needs at least one sample so the static shell can
 * be validated and prerendered (next/dist/docs 01-app dynamic-routes, "With
 * Cache Components").
 */
export function generateStaticParams() {
  return TICKERS.map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: PageProps<"/stock/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: ticker.toUpperCase() };
}

/**
 * One company page for every phase (UX.md 3.3 / 3.4). The content changes with
 * the lifecycle phase; the URL does not. The ticker is read inside Suspense so
 * the shell can be shared across company links.
 */
export default function StockPage({ params }: PageProps<"/stock/[ticker]">) {
  return (
    <Suspense fallback={<SkeletonChart className="pt-20" />}>
      <StockBody params={params} />
    </Suspense>
  );
}

async function StockBody({ params }: { params: PageProps<"/stock/[ticker]">["params"] }) {
  const { ticker } = await params;
  // A second boundary around the client tree: the back bar reads the URL, which
  // is runtime data on a dynamic route, so it streams in after the shell.
  return (
    <Suspense fallback={<SkeletonChart className="pt-20" />}>
      <CompanyScreen ticker={ticker} />
    </Suspense>
  );
}
