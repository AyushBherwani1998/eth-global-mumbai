import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Figtree, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/shell";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { THEME_COLORS, THEME_SCRIPT } from "@/components/theme";
import "./globals.css";

// Figtree for text, JetBrains Mono for labels and data (design/brand/TOKENS.md).
// Both are variable fonts, so the 400/500/700 steps the type roles ask for come
// from one file each.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "thaamba", template: "%s · thaamba" },
  description: "Buy and sell shares of listed Indian SMEs, and apply to new ICOs.",
  applicationName: "thaamba",
  appleWebApp: { capable: true, title: "thaamba", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${jetbrainsMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        {/* Pre-paint theme: reads ?theme= or localStorage and stamps data-theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          {/*
            TopNav reads usePathname (it hides itself on /console). On a route
            that is prerendered, Cache Components needs that read behind a
            Suspense boundary so the nav streams in after the shell; without it
            Next logs "URL data `usePathname()` in a Client Component outside of
            <Suspense>" for /stock/[ticker]. The nav is `hidden` below 1024px
            and sticky above it, so a null fallback costs no layout shift.
          */}
          <Suspense fallback={null}>
            <TopNav />
          </Suspense>
          <div className="min-h-dvh w-full bg-bg">{children}</div>
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
