import { BottomNav, Container } from "@/components/shell";

/** Tab screens: Markets, Orders, Portfolio, Console. Bottom nav on phone, none on desktop. */
export default function TabsLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Container className="pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-12">{children}</Container>
      <BottomNav />
    </>
  );
}
