import { prisma } from "@/lib/prisma";
import { currentOrg } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { TasksTable, type TaskRow } from "@/components/tables/TasksTable";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const org = await currentOrg();
  const tasks = await prisma.task.findMany({
    where: { project: { client: { organizationId: org.id } } },
    orderBy: [{ status: "asc" }, { priority: "asc" }],
    include: { project: true, assignee: true },
  });

  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectName: t.project.name,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee?.name ?? t.assignee?.email ?? "—",
    issueId: t.issueId,
  }));

  return (
    <div>
      <PageHeader title="Task" subtitle="Attività di remediation su tutti i progetti." />
      <TasksTable rows={rows} />
    </div>
  );
}
