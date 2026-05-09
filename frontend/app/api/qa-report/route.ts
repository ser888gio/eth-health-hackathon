import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const backendDir = path.join(process.cwd(), "..", "backend");

async function loadGeneratedSummary(audience: string) {
  const summaryPath = path.join(backendDir, "output", `summary_${audience}.json`);
  const raw = await readFile(summaryPath, "utf-8");
  return JSON.parse(raw);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const audience = searchParams.get("audience") || "lab";
  const force = searchParams.get("force") === "1";

  if (!["lab", "clinical", "general"].includes(audience)) {
    return NextResponse.json(
      { error: "audience must be one of lab, clinical, general" },
      { status: 400 },
    );
  }

  if (!force) {
    try {
      const cached = await loadGeneratedSummary(audience);
      return NextResponse.json({
        ...cached,
        audio_url: `/api/podcast?audience=${audience}`,
      });
    } catch {
      // Generate below when the cached report does not exist yet.
    }
  }

  try {
    await execFileAsync("uv", ["run", "generate_assets.py", "report.pdf", audience], {
      cwd: backendDir,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 4,
    });

    const generated = await loadGeneratedSummary(audience);
    return NextResponse.json({
      ...generated,
      audio_url: `/api/podcast?audience=${audience}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate QA report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
