import type { Metadata } from "next";
import { ConsoleListScreen } from "@/screens/console-list";

export const metadata: Metadata = { title: "Issuer console" };

export default function ConsoleIndexPage() {
  return <ConsoleListScreen />;
}
