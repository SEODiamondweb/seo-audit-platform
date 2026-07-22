import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Poll a Screaming Frog job status. GET /api/jobs/:jobId */
export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const job = await prisma.screamingFrogJob.findUnique({
    where: { id: params.jobId },
    select: { id: true, status: true, progress: true, message: true, errorMessage: true, auditId: true },
  });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
