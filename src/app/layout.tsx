import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second — Your AI 2IC",
  description: "Second — Dean Ormsby's AI 2IC (second-in-command)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
