import type { Metadata } from "next";
import { MarketListScreen } from "@/screens/market-list";

export const metadata: Metadata = { title: "Market" };

export default function MarketPage() {
  return <MarketListScreen />;
}
