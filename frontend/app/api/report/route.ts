import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const reportPath = path.join(process.cwd(), "..", "backend", "summarisation", "report.pdf");

const baseHeaders = {
  "Content-Type": "application/pdf",
  "Content-Disposition": 'inline; filename="report.pdf"',
  "Accept-Ranges": "bytes",
  "Cache-Control": "no-store",
};

export async function GET(request: NextRequest) {
  const { size } = await stat(reportPath);
  const range = request.headers.get("range");

  if (range) {
    const [startPart, endPart] = range.replace("bytes=", "").split("-");
    const start = Number.parseInt(startPart, 10);
    const end = endPart ? Number.parseInt(endPart, 10) : size - 1;

    if (Number.isNaN(start) || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    const file = await readFile(reportPath);
    const chunk = file.subarray(start, Math.min(end, size - 1) + 1);

    return new NextResponse(chunk, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${start + chunk.byteLength - 1}/${size}`,
      },
    });
  }

  const report = await readFile(reportPath);

  return new NextResponse(report, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}

export async function HEAD() {
  const { size } = await stat(reportPath);

  return new NextResponse(null, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
