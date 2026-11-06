import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IpoDetailScreen } from "@/screens/ipo-detail";
import { TICKERS, getIpo } from "@/lib/mock";

// The whole screen is keyed on `ticker`, so there is no URL-independent shell to
// stream, and wrapping the read in <Suspense> would turn unknown-ticker 404s into
// soft 200s. Let navigation block on the (cheap, synchronous) lookup instead.
export const instant = false;

export function generateStaticParams() {
  return TICKERS.map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: PageProps<"/ipo/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: getIpo(ticker)?.name ?? "IPO" };
}

export default async function IpoPage({ params }: PageProps<"/ipo/[ticker]">) {
  const { ticker } = await params;
  const ipo = getIpo(ticker);
  if (!ipo) notFound();
  return <IpoDetailScreen ipo={ipo} />;
}
