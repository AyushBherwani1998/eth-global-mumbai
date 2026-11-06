import type { Metadata } from "next";
import { MyBidsScreen } from "@/screens/my-bids";

export const metadata: Metadata = { title: "My bids" };

export default function BidsPage() {
  return <MyBidsScreen />;
}
