import type { Metadata } from "next";
import { PortfolioScreen } from "@/screens/portfolio";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return <PortfolioScreen />;
}
