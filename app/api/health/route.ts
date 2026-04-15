import { readRuntimeValue } from "@/lib/runtime-env";

export async function GET() {
  let groqConfigured = false;
  try {
    groqConfigured = Boolean(readRuntimeValue("GROQ_API_KEY"));
  } catch {
    // file-backed secret not accessible
  }

  const status = groqConfigured ? "ok" : "degraded";
  return Response.json(
    { status, services: { groq: groqConfigured ? "configured" : "missing" } },
    {
      status: groqConfigured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
