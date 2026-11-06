import type { Metadata } from "next";
import { ConsoleListScreen } from "@/screens/console-list";

export const metadata: Metadata = { title: "Console" };

export default function ConsoleIndexPage() {
  return <ConsoleListScreen />;
}
