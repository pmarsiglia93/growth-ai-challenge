import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growth AI Challenge",
  description: "Widget de enriquecimento de produto com IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">{children}</main>
      </body>
    </html>
  );
}
