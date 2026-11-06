import type { Metadata } from "next";
import { MyBidsScreen } from "@/screens/my-bids";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return <MyBidsScreen />;
}
