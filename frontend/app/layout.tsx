import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sophia Genetics Quality Report",
  description: "Quality report viewer prototype",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
