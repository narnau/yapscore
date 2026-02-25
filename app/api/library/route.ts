import { NextRequest, NextResponse } from "next/server";
import { listScores, addScore } from "@/lib/library";

export async function GET() {
  const scores = listScores();
  return NextResponse.json({ scores });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const name = formData.get("name") as string | null;
  const description = (formData.get("description") as string | null) ?? "";
  const file = formData.get("file") as File | null;

  if (!name || !file) {
    return NextResponse.json({ error: "Missing name or file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const entry = addScore(name, description, buffer);
  return NextResponse.json({ id: entry.id });
}
