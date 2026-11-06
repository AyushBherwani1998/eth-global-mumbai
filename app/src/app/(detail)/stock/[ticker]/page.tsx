import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyScreen } from "@/screens/company";
import { SkeletonChart } from "@/components/states";
import { TICKERS, getIpo, getMarket } from "@/lib/mock";

export function generateStaticParams() {
  return TICKERS.map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: PageProps<"/stock/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: getIpo(ticker)?.name ?? "Company" };
}

/**
 * One company page for every phase (UX.md 3.3 / 3.4). The content changes with
 * the lifecycle phase; the URL does not.
 */
export default async function StockPage({ params }: PageProps<"/stock/[ticker]">) {
  const { ticker } = await params;
  const ipo = getIpo(ticker);
  if (!ipo) notFound();
  const market = ipo.phase === "listed" ? getMarket(ticker) : undefined;
  return (
    <Suspense fallback={<SkeletonChart className="pt-20" />}>
      <CompanyScreen ipo={ipo} market={market} />
    </Suspense>
  );
}
