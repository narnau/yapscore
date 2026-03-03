import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import OpenAI from "openai";

// 10 transcriptions per user per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  if (!checkRateLimit(auth.userId)) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio") as File | null;
  if (!audio) return NextResponse.json({ error: "Missing audio" }, { status: 400 });

  const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
  if (audio.size > MAX_AUDIO_SIZE) {
    return NextResponse.json({ error: "Audio file too large (max 25 MB)" }, { status: 413 });
  }

  // MIME allowlist — reject non-audio uploads
  const mime = audio.type.split(";")[0]; // strip codecs suffix
  const formatMap: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg":  "ogg",
    "audio/mp4":  "mp4",
    "audio/m4a":  "mp4",
    "audio/wav":  "wav",
    "audio/flac": "flac",
    "audio/mpeg": "mp3",
  };
  if (!formatMap[mime]) {
    return NextResponse.json({ error: "Unsupported audio type" }, { status: 415 });
  }
  const format = formatMap[mime];

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENROUTER_API_KEY not set" }, { status: 500 });

  // openai/gpt-audio-mini supports input_audio in chat completions via OpenRouter
  const model = process.env.OPENROUTER_TRANSCRIBE_MODEL ?? "google/gemini-2.5-flash-lite";

  const buffer = Buffer.from(await audio.arrayBuffer());
  const base64 = buffer.toString("base64");

  console.log(`[transcribe] format=${format} size=${buffer.length}b model=${model}`);

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input_audio: { data: base64, format },
          } as any,
          {
            type: "text",
            text: "Transcribe this audio exactly as spoken. Return only the transcribed text, nothing else.",
          },
        ],
      },
    ],
    max_tokens: 1024,
  });

  const transcript = response.choices[0]?.message?.content?.trim() ?? "";
  console.log(`[transcribe] → "${transcript.slice(0, 100)}${transcript.length > 100 ? "…" : ""}"`);

  return NextResponse.json({ transcript });
}
