import { IssuerSessionProvider } from "@/components/console/session";

/** Console routes: a separate app with its own session, header and navigation. */
export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return <IssuerSessionProvider>{children}</IssuerSessionProvider>;
}
