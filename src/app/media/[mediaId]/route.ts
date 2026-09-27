import { NextResponse } from "next/server";
import { requireUser } from "@/lib/dal";
import { isUuid } from "@/lib/jobs/errors";
import { isR2Configured, presignGet } from "@/lib/media/r2";
import { LINK_SECONDS } from "@/lib/media/r2-core";
import { createAdminClient } from "@/lib/supabase/admin";

// Private viewing: checks that the signed-in user may see this proof file
// (the owner, or an active employee assigned to the job), then redirects to
// a short-lived signed link for that one object. Nobody else gets a usable
// link, and links stop working after a few minutes.
export async function GET(_request: Request, { params }: RouteContext<"/media/[mediaId]">) {
  const user = await requireUser();
  const { mediaId } = await params;
  const notFound = () =>
    new NextResponse("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });

  const admin = createAdminClient();
  if (!isUuid(mediaId) || !admin || !isR2Configured()) return notFound();

  const { data, error } = (await admin.rpc("authorize_media_view", {
    p_media: mediaId,
    p_actor: user.id,
  })) as {
    data: { object_key: string; content_type: string; media_type: "picture" | "video" }[] | null;
    error: { code?: string } | null;
  };
  if (error) {
    console.error("[media] authorize_media_view failed", { code: error.code });
    return notFound();
  }
  const media = data?.[0];
  if (!media) return notFound();

  const seconds = media.media_type === "video" ? LINK_SECONDS.viewVideo : LINK_SECONDS.viewPicture;
  const url = await presignGet(media.object_key, seconds, media.content_type);
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
  });
}
