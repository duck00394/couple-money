import type { Metadata, Viewport } from "next";
import { APP } from "@/config/app";
import "./globals.css";

export const metadata: Metadata = {
  title: APP.name,
  description: APP.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f3ed",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-dvh font-sans antialiased">
        <div className="mx-auto min-h-dvh max-w-md bg-canvas">{children}</div>
      </body>
    </html>
  );
}
