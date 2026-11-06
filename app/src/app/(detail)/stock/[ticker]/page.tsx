import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IpoDetailScreen } from "@/screens/ipo-detail";
import { MarketDetailScreen } from "@/screens/market-detail";
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
 * the lifecycle phase; the URL does not. Stopgap: listed companies render the
 * old market detail, everything else the old IPO detail.
 */
export default async function StockPage({ params }: PageProps<"/stock/[ticker]">) {
  const { ticker } = await params;
  const ipo = getIpo(ticker);
  if (!ipo) notFound();
  const market = ipo.phase === "listed" ? getMarket(ticker) : undefined;
  if (market) return <MarketDetailScreen ipo={ipo} market={market} />;
  return <IpoDetailScreen ipo={ipo} />;
}
