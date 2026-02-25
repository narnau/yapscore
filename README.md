# score-ai-web

A web application for editing MuseScore files using natural language instructions powered by an LLM.

## What it does

Upload a `.mscz` MuseScore file, select measures, type an instruction in plain language, and the LLM modifies the score. The result is shown in the viewer and can be downloaded as a new `.mscz` file.

## Stack

- **Next.js 15** (App Router, server-side API routes)
- **Verovio** — renders MusicXML to SVG in the browser (with measure selection)
- **OpenRouter** — LLM API (default model: `google/gemini-2.5-flash-preview`)
- **MuseScore 4** — CLI used server-side to convert `.mscz` ↔ MusicXML
- **adm-zip** — unzip/rezip `.mscz` files (ZIP format)

## How it works

```
User uploads .mscz
    → /api/load: mscore converts .mscz → MusicXML → stored in client state
    → Verovio renders MusicXML as SVG in browser

User selects measures + types instruction
    → /api/modify: extracts selected measures from MusicXML
    → sends to LLM with instruction
    → LLM returns modified MusicXML
    → spliced back into full MusicXML
    → mscore validates (converts back to .mscz)
    → new MusicXML returned to client → Verovio re-renders
```

## Setup

### Requirements

- [Bun](https://bun.sh)
- [MuseScore 4](https://musescore.org) installed (CLI accessible as `mscore` or `mscore4`)
- OpenRouter API key

### Install & run

```bash
bun install
cp .env.example .env.local   # fill in your keys
bun dev
```

### Environment variables

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=google/gemini-2.5-flash-preview   # optional, this is the default
MSCORE_PATH=/path/to/mscore                         # optional, auto-detected if in PATH
```

## Key files

```
app/
  page.tsx              — main layout, state management
  api/
    load/route.ts       — POST .mscz → returns MusicXML
    modify/route.ts     — POST MusicXML + instruction → returns modified MusicXML

components/
  ChatPanel.tsx         — file upload, instruction input, message history, measure selection badge
  ScoreViewer.tsx       — Verovio SVG renderer with clickable measure selection

lib/
  musicxml.ts           — extract/splice MusicXML parts and measures
  llm.ts                — OpenRouter call with logging
  mscore.ts             — MuseScore CLI wrapper (convert, validate)
  score.ts              — high-level score helpers
```

## Measure selection

Click a measure to select it (highlighted in blue). Shift/Cmd+click to multi-select. Selected measures are shown as a badge in the chat. When measures are selected, only those measures are sent to the LLM, reducing token usage significantly.

## LLM prompt strategy

Instead of sending the full MusicXML (~5500 tokens), only the `<part>` elements are sent (~3500 tokens). When specific measures are selected, only those measures are sent (~200 tokens). The LLM returns only the modified measures, which are spliced back into the original.
