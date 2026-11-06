import type { Metadata } from "next";
import { AboutScreen } from "@/screens/about";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return <AboutScreen />;
}
