import Link from "next/link";
import { clsx } from "clsx";

const SEV_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-lime-100 text-lime-800",
  INFO: "bg-cyan-100 text-cyan-800",
};

export function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={clsx("inline-block rounded-full px-2 py-0.5 text-xs font-semibold", tone ? SEV_STYLES[tone] ?? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-700")}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action, breadcrumbs }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  breadcrumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && (
        <div className="mb-2 flex flex-wrap gap-1 text-xs text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={b.href}>
              <Link href={b.href} className="hover:text-brand-600">{b.label}</Link>
              {i < breadcrumbs.length - 1 && <span className="mx-1">/</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-400">—</span>;
  const color = score >= 80 ? "text-green-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  return <span className={clsx("font-bold tabular-nums", color)}>{score}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}
