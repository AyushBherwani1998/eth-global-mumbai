import { notFound } from "next/navigation";
import { ConsoleScreen } from "@/screens/console";
import { CONSOLE, getIpo } from "@/lib/mock";

// The whole screen is keyed on `ticker`, so there is no URL-independent shell to
// stream, and wrapping the read in <Suspense> would turn unknown-ticker 404s into
// soft 200s. Let navigation block on the (cheap, synchronous) lookup instead.
export const instant = false;

export function generateStaticParams() {
  return Object.keys(CONSOLE)
    .filter((k) => getIpo(k))
    .map((ticker) => ({ ticker }));
}

export default async function ConsolePage({ params }: PageProps<"/console/[ticker]">) {
  const { ticker } = await params;
  if (!getIpo(ticker)) notFound();
  return <ConsoleScreen ticker={ticker} />;
}
