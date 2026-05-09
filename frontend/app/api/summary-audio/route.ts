import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const MAX_NARRATION_CHARS = 900;

type SummaryAudioRequest = {
  summary?: unknown;
};

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#*_>|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeSources(value: string) {
  return value.split(/\n\s*#{1,6}\s*Sources\b/i)[0] ?? value;
}

function removeNumbers(value: string) {
  return value
    .replace(/\[[\d\s,]+\]/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:%|x|X|bp|reads?|regions?|bases?|fold)?\b/g, " ")
    .replace(/\b(?:Q|S)\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function buildNarration(summary: string) {
  const source = removeNumbers(stripMarkdown(removeSources(summary)));
  const lower = source.toLowerCase();
  const status = hasAny(lower, [/fail|failed|warning|concern|low|poor|insufficient|review/])
    ? "This quality report needs careful review before the sample is treated as routine."
    : "This quality report looks broadly usable, with the main checks focused on confidence and consistency.";
  const explanations: string[] = [status];

  if (hasAny(lower, [/coverage|covered|target region|low coverage/])) {
    explanations.push(
      "Coverage matters because it tells us whether the report has enough read support across the target regions to make reliable variant calls.",
    );
  }

  if (hasAny(lower, [/on target|mapping|mapped|off target/])) {
    explanations.push(
      "Mapping quality matters because reads that land on the intended targets give the analysis more useful evidence and reduce wasted sequencing signal.",
    );
  }

  if (hasAny(lower, [/duplicate|pcr/])) {
    explanations.push(
      "Duplicate reads matter because they can make confidence look stronger than it really is, especially when the same original molecule is counted repeatedly.",
    );
  }

  if (hasAny(lower, [/soft.?clipp|clipping|adapter|alignment/])) {
    explanations.push(
      "Clipping and alignment issues matter because they can point to noisy read ends, library artefacts, or regions where variant interpretation deserves extra caution.",
    );
  }

  if (hasAny(lower, [/recommended|follow.?up|action|rerun|manual|review|inspect/])) {
    explanations.push(
      "The practical next step is to review the flagged regions and decide whether manual inspection or repeat testing is needed.",
    );
  }

  if (explanations.length === 1) {
    explanations.push(
      "The most important metrics are coverage, mapping quality, duplication, and alignment consistency, because together they show whether the data can support a dependable clinical interpretation.",
    );
  }

  return explanations.join(" ").slice(0, MAX_NARRATION_CHARS);
}

function parseEnvValue(contents: string, key: string) {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = trimmed.slice(0, separatorIndex).trim();
    if (name !== key) continue;

    return trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }

  return "";
}

async function envValue(key: string) {
  if (process.env[key]) return process.env[key] ?? "";

  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "..", ".env"),
  ];

  for (const envPath of candidates) {
    try {
      const contents = await readFile(envPath, "utf-8");
      const value = parseEnvValue(contents, key);
      if (value) return value;
    } catch {
      // Keep checking other supported env locations.
    }
  }

  return "";
}

export async function POST(request: NextRequest) {
  const apiKey = (await envValue("ELEVENLABS_API_KEY")) || (await envValue("ELEVEN_API_KEY"));

  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not configured. Add it to frontend/.env.local or the repo-root .env." },
      { status: 500 },
    );
  }

  let body: SummaryAudioRequest;
  try {
    body = (await request.json()) as SummaryAudioRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) {
    return NextResponse.json({ error: "Summary text is required." }, { status: 400 });
  }

  const voiceId = (await envValue("ELEVENLABS_VOICE_ID")) || DEFAULT_VOICE_ID;
  const modelId = (await envValue("ELEVENLABS_MODEL_ID")) || DEFAULT_MODEL_ID;
  const narration = buildNarration(summary);

  try {
    const response = await fetch(`${ELEVENLABS_TTS_URL}/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: narration,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return NextResponse.json(
        { error: errorText || `ElevenLabs request failed with status ${response.status}.` },
        { status: response.status },
      );
    }

    const audio = await response.arrayBuffer();
    const audioUrl = `data:audio/mpeg;base64,${Buffer.from(audio).toString("base64")}`;
    return NextResponse.json({ audioUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate summary audio.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
