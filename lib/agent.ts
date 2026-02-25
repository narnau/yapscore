import OpenAI from "openai";

export type LibraryItem = {
  id: string;
  name: string;
  description: string;
};

export type AgentIntent =
  | { action: "load"; scoreId: string }
  | { action: "load_and_modify"; scoreId: string; instruction: string }
  | { action: "modify"; instruction: string }
  | { action: "generate"; description: string }
  | { action: "chat"; response: string };

function buildIntentPrompt(
  message: string,
  library: LibraryItem[],
  hasCurrentScore: boolean
): string {
  const libraryText =
    library.length > 0
      ? library.map((s) => `- id: "${s.id}", name: "${s.name}", description: "${s.description}"`).join("\n")
      : "(empty — no scores stored)";

  return `You are an assistant for a music score editor that can load scores and apply modifications.

Available scores in library:
${libraryText}

Current score loaded: ${hasCurrentScore ? "yes" : "no"}

User message: "${message}"

RULES:
1. Match scores FUZZILY — partial name matches, different languages, and typos all count.
   Example: "baile inolvidable" matches "Baile inolvidable - Bad Bunny".
2. If the user asks for a melody/arrangement for a DIFFERENT instrument than what's in the library,
   you CAN still use that score — just include transposition in the instruction.
   Example: user asks for piano version of a Bb trumpet score → load it with instruction
   "Transcribe the melody for piano. The original is written for Bb trumpet (sounds a major 2nd lower than written), so transpose all pitches down a major 2nd to concert pitch."
3. Prefer action over conversation. If there is a plausible library match, use "load" or "load_and_modify" rather than "chat".
4. If no library score matches but the user is asking for a well-known melody, song, or composition, use "generate" — the system can compose it from musical knowledge.
5. Only use "chat" if the request has nothing to do with music scores.

Reply with a JSON object ONLY (no markdown, no explanation):

{ "action": "load", "scoreId": "<id>" }
  → load a score from the library without modification

{ "action": "load_and_modify", "scoreId": "<id>", "instruction": "<detailed MusicXML edit instruction in English>" }
  → load a library score and immediately apply a modification

{ "action": "modify", "instruction": "<detailed MusicXML edit instruction in English>" }
  → modify the currently loaded score (only when no library score is needed)

{ "action": "generate", "description": "<what to generate, e.g. 'Twinkle Twinkle Little Star for piano, simple melody, C major'>" }
  → compose a new score from musical knowledge when nothing in the library matches

{ "action": "chat", "response": "<reply to user>" }
  → only when no score action is possible`;
}

export async function detectIntent(
  message: string,
  library: LibraryItem[],
  hasCurrentScore: boolean
): Promise<AgentIntent> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview";
  const prompt = buildIntentPrompt(message, library, hasCurrentScore);

  console.log("[agent] detecting intent...");

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 256,
  });

  const raw = (response.choices[0].message.content ?? "").trim();
  console.log(`[agent] intent raw: ${raw}`);

  // Strip markdown fences if present
  let json = raw;
  if (json.startsWith("```")) {
    json = json.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    return JSON.parse(json) as AgentIntent;
  } catch {
    // Fallback: treat as chat
    return { action: "chat", response: raw };
  }
}
