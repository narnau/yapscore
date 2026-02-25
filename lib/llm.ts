import OpenAI from "openai";

function buildInitialPrompt(parts: string, context: string, instruction: string): string {
  return `You are a music notation expert working with MusicXML.

Score info: ${context}
Instruction: "${instruction}"

RULES:
1. Return ONLY the modified <part> element(s). No explanations, no markdown fences.
2. Keep the same part IDs and measure numbers.
3. Pitch: use <alter>1</alter> for sharp, <alter>-1</alter> for flat, INSIDE <pitch>.
4. Accidentals: whenever a note carries an accidental sign (#, b, ♮), add the matching
   element AFTER </pitch> inside the same <note>:
     <accidental>sharp</accidental>   for #
     <accidental>flat</accidental>    for b
     <accidental>natural</accidental> for ♮
   Notes that are sharp/flat only because of the key signature do NOT need <accidental>.
   Notes that restore a previously altered note DO need <accidental>natural</accidental>.
5. Every <note> needs: <pitch> (or <rest/>), <duration>, <type>.
6. Duration values (assuming <divisions>1</divisions>): whole=4, half=2, quarter=1, eighth=0.5.
   If divisions differ, scale accordingly.
7. Remove trailing empty measures that are not needed.

CURRENT PARTS:
${parts}`;
}

function buildRetryPrompt(parts: string, context: string, instruction: string, errorMsg: string): string {
  return `The MusicXML you generated was INVALID and could not be rendered.

Error: ${errorMsg}

Score info: ${context}
Instruction: "${instruction}"

Fix the issue and return ONLY the corrected <part> element(s). No explanations.

ORIGINAL PARTS:
${parts}`;
}

function stripMarkdownFences(text: string): string {
  text = text.trim();
  if (text.startsWith("```xml")) return text.split("```xml")[1].split("```")[0].trim();
  if (text.startsWith("```")) return text.split("```")[1].split("```")[0].trim();
  return text;
}

async function callOpenRouter(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview";

  console.log("─────────────────────────────────────────");
  console.log(`[llm] model      : ${model}`);
  console.log(`[llm] prompt len : ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens estimated)`);
  console.log("[llm] prompt preview:");
  console.log(prompt.slice(0, 400) + (prompt.length > 400 ? "\n  ...(truncated)" : ""));
  console.log("─────────────────────────────────────────");

  const TIMEOUT_MS = 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.log(`[llm] ⚠ timeout after ${TIMEOUT_MS / 1000}s — aborting`);
    controller.abort();
  }, TIMEOUT_MS);

  let response;
  try {
    response = await client.chat.completions.create(
      { model, messages: [{ role: "user", content: prompt }], max_tokens: 8192 },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }

  const content = response.choices[0].message.content ?? "";
  const usage = response.usage;

  console.log("─────────────────────────────────────────");
  console.log(`[llm] finish reason  : ${response.choices[0].finish_reason}`);
  if (usage) {
    console.log(`[llm] tokens in      : ${usage.prompt_tokens}`);
    console.log(`[llm] tokens out     : ${usage.completion_tokens}`);
    console.log(`[llm] tokens total   : ${usage.total_tokens}`);
  }
  console.log(`[llm] response len   : ${content.length} chars`);
  console.log("[llm] response preview:");
  console.log(content.slice(0, 300) + (content.length > 300 ? "\n  ...(truncated)" : ""));
  console.log("─────────────────────────────────────────");

  return stripMarkdownFences(content);
}

function buildGeneratePrompt(description: string): string {
  return `You are a music notation expert. Generate a complete, valid MusicXML 3.1 file for the following:

"${description}"

RULES:
1. Return ONLY the raw MusicXML. No explanations, no markdown fences.
2. Start with: <?xml version="1.0" encoding="UTF-8"?>
3. Use <score-partwise version="3.1"> as root element.
4. Include proper <part-list> with <score-part> and <part-name>.
5. Every <note> must have: <pitch> (or <rest/>), <duration>, <type>.
6. Use <divisions>1</divisions> per measure where quarter = 1.
7. Include correct <key>, <time>, <clef> in the first measure attributes.
8. Accidentals: use <alter>1</alter>/<alter>-1</alter> inside <pitch> for sharp/flat.
   Also add the display element AFTER </pitch> in the same <note>:
     <accidental>sharp</accidental>   for #
     <accidental>flat</accidental>    for b
     <accidental>natural</accidental> for ♮
   Notes already covered by the key signature do NOT need <accidental>.
   Notes that cancel a previous accidental DO need <accidental>natural</accidental>.
9. Write the complete melody — do not truncate.`;
}

export async function generateXml(description: string): Promise<string> {
  const prompt = buildGeneratePrompt(description);
  const raw = await callOpenRouter(prompt);
  // Strip any accidental markdown fences
  return stripMarkdownFences(raw);
}

export async function modifyXml(
  parts: string,
  context: string,
  instruction: string,
  errorMsg?: string
): Promise<string> {
  const prompt = errorMsg
    ? buildRetryPrompt(parts, context, instruction, errorMsg)
    : buildInitialPrompt(parts, context, instruction);

  return callOpenRouter(prompt);
}
