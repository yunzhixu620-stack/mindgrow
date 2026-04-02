import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MainLayout } from "@/components/layout/main-layout";

export const metadata: Metadata = {
  title: "MindGrow — 思维生长的知识有机体",
  description: "你只管想，我来长",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
