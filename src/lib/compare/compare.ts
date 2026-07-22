export interface CompareUrl {
  url: string;
  statusCode?: number | null;
  title?: string | null;
  canonical?: string | null;
  indexability?: string | null;
}

export interface CompareIssue {
  ruleKey: string;
  title: string;
  severity: string;
  affectedCount: number;
}

export interface CompareInput {
  base: { score: number | null; issues: CompareIssue[]; urls: CompareUrl[] };
  current: { score: number | null; issues: CompareIssue[]; urls: CompareUrl[] };
}

export interface FieldChange {
  url: string;
  from: unknown;
  to: unknown;
}

export interface CompareResult {
  scoreDelta: number | null;
  newIssues: CompareIssue[];
  resolvedIssues: CompareIssue[];
  persistentIssues: { ruleKey: string; title: string; severity: string; fromCount: number; toCount: number }[];
  newUrls: string[];
  removedUrls: string[];
  statusChanges: FieldChange[];
  titleChanges: FieldChange[];
  canonicalChanges: FieldChange[];
  indexabilityChanges: FieldChange[];
}

/** Pure diff of two audit snapshots. */
export function diffAudits(input: CompareInput): CompareResult {
  const { base, current } = input;

  const baseIssues = new Map(base.issues.map((i) => [i.ruleKey, i]));
  const currIssues = new Map(current.issues.map((i) => [i.ruleKey, i]));

  const newIssues = current.issues.filter((i) => !baseIssues.has(i.ruleKey));
  const resolvedIssues = base.issues.filter((i) => !currIssues.has(i.ruleKey));
  const persistentIssues = current.issues
    .filter((i) => baseIssues.has(i.ruleKey))
    .map((i) => ({
      ruleKey: i.ruleKey,
      title: i.title,
      severity: i.severity,
      fromCount: baseIssues.get(i.ruleKey)!.affectedCount,
      toCount: i.affectedCount,
    }));

  const baseUrls = new Map(base.urls.map((u) => [u.url, u]));
  const currUrls = new Map(current.urls.map((u) => [u.url, u]));

  const newUrls = current.urls.filter((u) => !baseUrls.has(u.url)).map((u) => u.url);
  const removedUrls = base.urls.filter((u) => !currUrls.has(u.url)).map((u) => u.url);

  const statusChanges: FieldChange[] = [];
  const titleChanges: FieldChange[] = [];
  const canonicalChanges: FieldChange[] = [];
  const indexabilityChanges: FieldChange[] = [];

  for (const [url, cur] of currUrls) {
    const prev = baseUrls.get(url);
    if (!prev) continue;
    if ((prev.statusCode ?? null) !== (cur.statusCode ?? null))
      statusChanges.push({ url, from: prev.statusCode ?? null, to: cur.statusCode ?? null });
    if ((prev.title ?? "") !== (cur.title ?? ""))
      titleChanges.push({ url, from: prev.title ?? null, to: cur.title ?? null });
    if ((prev.canonical ?? "") !== (cur.canonical ?? ""))
      canonicalChanges.push({ url, from: prev.canonical ?? null, to: cur.canonical ?? null });
    if ((prev.indexability ?? "") !== (cur.indexability ?? ""))
      indexabilityChanges.push({ url, from: prev.indexability ?? null, to: cur.indexability ?? null });
  }

  const scoreDelta =
    base.score != null && current.score != null ? current.score - base.score : null;

  return {
    scoreDelta,
    newIssues,
    resolvedIssues,
    persistentIssues,
    newUrls,
    removedUrls,
    statusChanges,
    titleChanges,
    canonicalChanges,
    indexabilityChanges,
  };
}

/** Load two audits from the DB and diff them. */
export async function compareAudits(baseId: string, currentId: string): Promise<CompareResult> {
  const [base, current] = await Promise.all([loadSnapshot(baseId), loadSnapshot(currentId)]);
  return diffAudits({ base, current });
}

async function loadSnapshot(auditId: string) {
  const { prisma } = await import("../prisma");
  const audit = await prisma.audit.findUniqueOrThrow({
    where: { id: auditId },
    select: {
      score: true,
      issues: { select: { ruleKey: true, title: true, severity: true, affectedCount: true } },
      urls: { select: { url: true, statusCode: true, title: true, canonical: true, indexability: true } },
    },
  });
  return {
    score: audit.score,
    issues: audit.issues,
    urls: audit.urls.map((u) => ({ ...u, indexability: u.indexability as string })),
  };
}
