import { NextResponse } from "next/server";
import { requireUser } from "@/lib/dal";
import { isUuid } from "@/lib/jobs/errors";
import { isR2Configured, presignGet } from "@/lib/media/r2";
import { LINK_SECONDS } from "@/lib/media/r2-core";
import { createAdminClient } from "@/lib/supabase/admin";

// Private viewing of a reference picture (guidance, never proof): checks the
// signed-in user may see it (owners; employees for standard steps and for
// jobs they work on), then redirects to a short-lived signed link.
export async function GET(_request: Request, { params }: RouteContext<"/reference/[pictureId]">) {
  const user = await requireUser();
  const { pictureId } = await params;
  const notFound = () =>
    new NextResponse("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });

  const admin = createAdminClient();
  if (!isUuid(pictureId) || !admin || !isR2Configured()) return notFound();

  const { data, error } = await admin.rpc("authorize_reference_view", { p_picture: pictureId, p_actor: user.id });
  if (error) {
    console.error("[reference] authorize_reference_view failed", { code: error.code });
    return notFound();
  }
  const picture = Array.isArray(data) ? data[0] : null;
  if (!picture) return notFound();

  const url = await presignGet(picture.object_key, LINK_SECONDS.viewPicture, picture.content_type);
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
  });
}
