import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/ans/app-shell";

export const metadata: Metadata = {
  title: "gyaani · ANS",
  description:
    "Horizon Scan: regulatory alerts, client newsletters and matter scanning, over a tracked index of Indian regulators.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Lato, the face used in the firm's mockups. Deliberately a runtime
            <link> and not next/font/google -- see app/globals.css for why a
            build-time font fetch is not safe in this repo. If it fails to
            load the system stack behind it takes over. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-ans-canvas text-[16px] text-ans-ink">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
