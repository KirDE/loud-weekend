import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { FestivalRefreshError, refreshFestival } from "@/lib/admin-store";
import { error } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const admin = await currentAdmin(["ADMIN"]);
  if (!admin) return error("Forbidden", 403);
  const year = new URL(request.url).searchParams.get("year");
  if (year !== null && !/^(?:20[0-9]{2}|2100)$/.test(year)) return error("Invalid edition year.", 400);
  try {
    const refreshed = await refreshFestival((await params).slug, admin, year === null ? undefined : Number(year));
    return NextResponse.json(refreshed, { status: 201 });
  } catch (cause) {
    if (cause instanceof FestivalRefreshError) return error(cause.message, cause.status);
    return error("Festival source refresh failed.", 502);
  }
}
