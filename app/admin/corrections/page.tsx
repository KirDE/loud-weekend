import { redirect } from "next/navigation";
import { CorrectionQueue } from "@/components/CorrectionQueue";
import { currentAdmin } from "@/lib/admin-access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Correction reports", robots: { index: false } };

export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await currentAdmin())) redirect("/?admin=forbidden");
  const params = await searchParams;
  const reviewed = params.view === "reviewed";
  const requestedPage =
    typeof params.page === "string" && /^[1-9][0-9]{0,8}$/.test(params.page)
      ? Number(params.page)
      : 1;
  const where = reviewed ? { status: { not: "PENDING" as const } } : { status: "PENDING" as const };
  const pageSize = 25;
  const count = await db.correctionReport.count({ where });
  const lastPage = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(requestedPage, lastPage);
  const reports = await db.correctionReport.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      targetName: true,
      editionYear: true,
      kind: true,
      sourceUrl: true,
      notes: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewerId: true,
    },
  });
  return (
    <CorrectionQueue
      reviewed={reviewed}
      page={page}
      lastPage={lastPage}
      reports={reports.map((report) => ({
        ...report,
        submittedAt: report.submittedAt.toISOString(),
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
      }))}
    />
  );
}
