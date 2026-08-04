import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Regulatory Update Wiki",
  description:
    "Tracked regulatory documents from Indian telecom and broadcasting regulators.",
};

const NAV = [
  { href: "/documents", label: "All documents" },
  { href: "/regulators", label: "Regulators" },
  { href: "/domains", label: "Domains" },
  { href: "/subjects", label: "Subjects" },
  { href: "/instruments", label: "Instruments" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      {/* text-[16.5px] lifts the whole UI a notch above Tailwind's 16px
          default -- these pages are dense reference tables, and the previous
          text-sm-everywhere sizing was genuinely hard to scan. */}
      <body className="flex min-h-full flex-col bg-background text-[16.5px] text-foreground">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex h-14 items-center justify-between gap-4">
              <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
                Regulatory Update Wiki
              </Link>
              {/* Plain GET form: search works with no JavaScript and the
                  resulting URL is shareable. */}
              <form action="/documents" method="get" className="hidden max-w-sm flex-1 sm:block">
                <Input
                  type="search"
                  name="q"
                  placeholder="Search all documents..."
                  aria-label="Search all documents"
                />
              </form>
              <Link
                href="/admin/review"
                className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Review queue
              </Link>
            </div>
            <nav className="flex gap-1 overflow-x-auto pb-2 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-3 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-5 text-sm text-muted-foreground">
            Documents are mirrored from each regulator&apos;s own public website. Always
            confirm against the linked source before relying on an entry.
          </div>
        </footer>
      </body>
    </html>
  );
}
