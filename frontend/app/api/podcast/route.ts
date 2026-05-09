import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const backendDir = path.join(process.cwd(), "..", "backend");

const baseHeaders = {
  "Content-Type": "audio/mpeg",
  "Content-Disposition": 'inline; filename="qa-briefing.mp3"',
  "Accept-Ranges": "bytes",
  "Cache-Control": "no-store",
};

function audioPathFor(request: NextRequest) {
  const audience = request.nextUrl.searchParams.get("audience") || "lab";
  const safeAudience = ["lab", "clinical", "general"].includes(audience) ? audience : "lab";
  return path.join(backendDir, "output", `briefing_${safeAudience}.mp3`);
}

export async function GET(request: NextRequest) {
  const audioPath = audioPathFor(request);
  const { size } = await stat(audioPath);
  const range = request.headers.get("range");

  if (range) {
    const [startPart, endPart] = range.replace("bytes=", "").split("-");
    const start = Number.parseInt(startPart, 10);
    const end = endPart ? Number.parseInt(endPart, 10) : size - 1;

    if (Number.isNaN(start) || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
      });
    }

    const audio = await readFile(audioPath);
    const chunk = audio.subarray(start, Math.min(end, size - 1) + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${start + chunk.byteLength - 1}/${size}`,
      },
    });
  }

  const audio = await readFile(audioPath);
  return new NextResponse(audio, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
