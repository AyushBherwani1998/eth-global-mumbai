import { Suspense } from "react";
import { MarketsScreen } from "@/screens/markets";
import { SkeletonList } from "@/components/states";

/** Markets: Stocks | ICO chips, selection in ?tab= (read client-side, so the shell prerenders). */
export default function Home() {
  return (
    <Suspense fallback={<SkeletonList rows={6} className="pt-16" />}>
      <MarketsScreen />
    </Suspense>
  );
}
