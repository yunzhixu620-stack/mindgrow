import type { Metadata } from "next";
import "./globals.css";
import { MainLayout } from "@/components/layout/main-layout";

export const metadata: Metadata = {
  title: "MindGrow — 思维生长的知识有机体",
  description: "你只管想，我来长",
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
