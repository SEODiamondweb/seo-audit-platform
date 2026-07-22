import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEO Audit Platform",
  description: "Crea e gestisci SEO Audit professionali con Screaming Frog.",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/clients", label: "Clienti" },
  { href: "/tasks", label: "Task" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
            <div className="mb-6 flex items-center gap-2 px-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">SF</div>
              <span className="font-semibold">SEO Audit</span>
            </div>
            <nav className="space-y-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 overflow-x-hidden p-6 lg:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
