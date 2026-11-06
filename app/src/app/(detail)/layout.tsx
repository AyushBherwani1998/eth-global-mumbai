import { Container } from "@/components/shell";

/** Detail screens: company page, about. Room for the fixed action bar on phone. */
export default function DetailLayout({ children }: LayoutProps<"/">) {
  return <Container className="pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-12">{children}</Container>;
}
