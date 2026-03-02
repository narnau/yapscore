import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createScore } from "@/lib/musicxml";

export async function GET() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const musicXml = createScore({
    instruments: [{ name: "Piano", staves: 2, midiProgram: 0 }],
    measures: 4,
  });

  return NextResponse.json({ musicXml });
}
