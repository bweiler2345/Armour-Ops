// Production health check: confirms the app is responding. It touches no
// database, reads no secrets, and returns nothing about the system.
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
