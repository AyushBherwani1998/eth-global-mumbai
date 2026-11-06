import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Listing Day", template: "%s · Listing Day" },
  description: "SME IPOs on Uniswap CCA + v4. Public price discovery, private browsing.",
  applicationName: "Listing Day",
  appleWebApp: { capable: true, title: "Listing Day", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body>
        <Providers>
          <div className="relative mx-auto min-h-dvh w-full max-w-[480px] bg-bg shadow-[0_0_0_1px_var(--line)]">{children}</div>
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
