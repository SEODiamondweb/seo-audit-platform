import { prisma } from "./prisma";

/**
 * Resolve the "current" organization. This starter is single-tenant for the
 * demo (first org, or a created default). Replace with real auth/session.
 */
export async function currentOrg() {
  let org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    org = await prisma.organization.create({ data: { name: "Default Org", slug: "default" } });
  }
  return org;
}

export async function dashboardStats() {
  const org = await currentOrg();
  const [clients, projects, audits, openIssues, runningJobs] = await Promise.all([
    prisma.client.count({ where: { organizationId: org.id } }),
    prisma.project.count({ where: { client: { organizationId: org.id } } }),
    prisma.audit.count({ where: { project: { client: { organizationId: org.id } } } }),
    prisma.auditIssue.count({ where: { status: "OPEN", audit: { project: { client: { organizationId: org.id } } } } }),
    prisma.screamingFrogJob.count({ where: { status: { in: ["QUEUED", "RUNNING", "EXPORTING", "IMPORTING"] } } }),
  ]);
  return { clients, projects, audits, openIssues, runningJobs };
}
