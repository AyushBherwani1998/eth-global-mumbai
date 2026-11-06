import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConsoleScreen } from "@/screens/console";
import { CONSOLE, getIpo } from "@/lib/mock";

export function generateStaticParams() {
  return Object.keys(CONSOLE)
    .filter((k) => getIpo(k))
    .map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: PageProps<"/console/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: `Console · ${getIpo(ticker)?.symbol ?? ticker}` };
}

export default async function ConsolePage({ params }: PageProps<"/console/[ticker]">) {
  const { ticker } = await params;
  if (!getIpo(ticker)) notFound();
  return <ConsoleScreen ticker={ticker} />;
}
