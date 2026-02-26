import OpenAI from "openai";

function buildInitialPrompt(parts: string, context: string, instruction: string): string {
  return `You are a music notation expert working with MusicXML.

Score info: ${context}
Instruction: "${instruction}"

RULES:
1. Return ONLY the modified <part> element(s). No explanations, no markdown fences.
2. Keep the same part IDs. Keep measure numbers unless deleting measures.
   - DELETE a measure (remove entirely, score gets shorter): omit it from the output.
     The system will remove it and renumber all subsequent measures automatically.
   - CLEAR a measure (keep the measure but empty its content): replace all notes with
     a whole rest: <note><rest/><duration>WHOLE</duration><type>whole</type></note>
     where WHOLE = divisions * beats (e.g. divisions=4, 4/4 time → duration=16).
3. Pitch: use <alter>1</alter> for sharp, <alter>-1</alter> for flat, INSIDE <pitch>.
4. Accidentals: whenever a note carries an accidental sign (#, b, ♮), add the matching
   element AFTER </pitch> inside the same <note>:
     <accidental>sharp</accidental>   for #
     <accidental>flat</accidental>    for b
     <accidental>natural</accidental> for ♮
   Notes that are sharp/flat only because of the key signature do NOT need <accidental>.
   Notes that restore a previously altered note DO need <accidental>natural</accidental>.
5. Every <note> needs: <pitch> (or <rest/>), <duration>, <type>.
6. Use the <divisions> already present in the score. Duration values are INTEGER ticks:
   divisions=1 → quarter=1 (avoid eighths!); divisions=2 → eighth=1, quarter=2;
   divisions=4 → 16th=1, eighth=2, quarter=4, half=8, whole=16 (preferred).
7. Remove trailing empty measures that are not needed.
8. Chord symbols: if using <harmony>, put ONLY the quality in <kind text="...">, never
   repeat the root note. E.g., <kind text="maj7"> not <kind text="Dmaj7">.
9. Multiple staves within one part (piano, organ, etc.):
   - In <attributes>: <staves>N</staves> and one <clef number="k"> per staff k=1..N.
   - For each measure: write all notes for staff 1 with <staff>1</staff>, then
     <backup><duration>TICKS</duration></backup> (TICKS = total ticks in measure),
     then all notes for staff 2 with <staff>2</staff>, then another <backup> and
     staff 3, etc. Repeat the <backup> pattern for every additional staff.
10. Adding a new instrument (new part): add a new <part id="P2"> block; the system
    will auto-add the matching <score-part> entry to <part-list>.
11. Preserve all <direction> elements (tempo markings, dynamics, etc.) unless the
    instruction specifically asks to change them.

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
6. Use <divisions>4</divisions>. Duration values (integer ticks):
   16th=1, eighth=2, dotted-eighth=3, quarter=4, dotted-quarter=6, half=8, dotted-half=12, whole=16.
7. Include correct <key>, <time>, <clef> in the first measure attributes.
8. Accidentals: use <alter>1</alter>/<alter>-1</alter> inside <pitch> for sharp/flat.
   Also add the display element AFTER </pitch> in the same <note>:
     <accidental>sharp</accidental>   for #
     <accidental>flat</accidental>    for b
     <accidental>natural</accidental> for ♮
   Notes already covered by the key signature do NOT need <accidental>.
   Notes that cancel a previous accidental DO need <accidental>natural</accidental>.
9. Chord symbols: put ONLY the quality in <kind text="...">, not the root letter.
10. Multi-staff parts (piano, organ, etc.): add <staves>N</staves> and one
    <clef number="k"> per staff in <attributes>. Write staff 1 notes with <staff>1</staff>,
    then <backup><duration>TICKS</duration></backup>, then staff 2 with <staff>2</staff>,
    then another <backup> for each additional staff. TICKS = total ticks in the measure.
11. Tempo: in the FIRST measure, add a <direction> with both a visual metronome marking
    and a playback tempo BEFORE the first <note>:
      <direction placement="above">
        <direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>BPM</per-minute></metronome></direction-type>
        <sound tempo="BPM"/>
      </direction>
    Choose an appropriate BPM for the style (e.g. Ballad=70, Andante=90, Allegro=130).
12. Write the complete score — do not truncate.`;
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
