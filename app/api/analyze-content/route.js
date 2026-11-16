import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handleAnalyzeContentRequest } from "@/lib/analyzeContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request) {
  try {
    const { env } = getCloudflareContext();
    return await handleAnalyzeContentRequest(request, env.DB, env);
  } catch (error) {
    console.error("Cloudflare request context unavailable", error);
    return Response.json({ error: "Unable to analyze content." }, { status: 500 });
  }
}

export async function POST(request) {
  return handle(request);
}

export async function OPTIONS(request) {
  return handle(request);
}

export async function GET(request) {
  return handle(request);
}
