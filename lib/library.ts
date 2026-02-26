import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export type ScoreEntry = {
  id: string;
  name: string;
  description: string;
  uploadedAt: string;
};

export async function listScores(
  supabase: SupabaseClient,
  userId: string
): Promise<ScoreEntry[]> {
  const { data, error } = await supabase
    .from("scores")
    .select("id, name, description, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    uploadedAt: row.created_at,
  }));
}

export async function addScore(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  description: string,
  msczBuffer: Buffer
): Promise<ScoreEntry> {
  const id = randomUUID();
  const filePath = `${userId}/${id}.mscz`;

  // Upload to Storage
  const { error: storageError } = await supabase.storage
    .from("scores")
    .upload(filePath, msczBuffer, {
      contentType: "application/octet-stream",
      upsert: false,
    });

  if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

  // Insert DB row
  const { error: dbError } = await supabase.from("scores").insert({
    id,
    user_id: userId,
    name,
    description,
    file_path: filePath,
  });

  if (dbError) {
    // Clean up storage on DB failure
    await supabase.storage.from("scores").remove([filePath]);
    throw new Error(`Database insert failed: ${dbError.message}`);
  }

  return {
    id,
    name,
    description,
    uploadedAt: new Date().toISOString(),
  };
}

export async function deleteScore(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<boolean> {
  // Get file path first
  const { data: row } = await supabase
    .from("scores")
    .select("file_path")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!row) return false;

  // Delete from Storage
  await supabase.storage.from("scores").remove([row.file_path]);

  // Delete DB row
  const { error } = await supabase
    .from("scores")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  return !error;
}

export async function getScoreBuffer(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<{ buffer: Buffer; name: string } | null> {
  const { data: row } = await supabase
    .from("scores")
    .select("file_path, name")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!row) return null;

  const { data, error } = await supabase.storage
    .from("scores")
    .download(row.file_path);

  if (error || !data) return null;

  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    name: row.name,
  };
}
