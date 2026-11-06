import { iconImage } from "@/lib/icon-image";

export function GET() {
  return iconImage(512, { maskable: true });
}
