import type { Metadata } from "next";
import { OrdersScreen } from "@/screens/orders";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return <OrdersScreen />;
}
