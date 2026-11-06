import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketDetailScreen } from "@/screens/market-detail";
import { LISTED_TICKERS, getIpo, getMarket } from "@/lib/mock";

export function generateStaticParams() {
  return LISTED_TICKERS.map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: PageProps<"/market/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: getIpo(ticker)?.symbol ?? "Market" };
}

export default async function MarketTickerPage({ params }: PageProps<"/market/[ticker]">) {
  const { ticker } = await params;
  const ipo = getIpo(ticker);
  const market = getMarket(ticker);
  if (!ipo || !market) notFound();
  return <MarketDetailScreen ipo={ipo} market={market} />;
}
