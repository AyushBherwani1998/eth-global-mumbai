import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Listing Day",
    short_name: "Listing Day",
    description: "Buy and sell shares of listed Indian SMEs, and apply to new IPOs.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    // The splash can carry only one value; keep the light ground. The meta
    // theme-color is updated at runtime for dark (components/theme.tsx).
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    categories: ["finance"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
