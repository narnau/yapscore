import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/components/ChatPanel";

export type HistoryEntry = {
  musicXml: string;
  name: string | null;
  timestamp: string;
  messages?: Message[];
};

export type FileEntry = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type FileData = FileEntry & {
  current_xml: string | null;
  history: HistoryEntry[];
  messages: Message[];
  swing: boolean | null;
};

const MAX_HISTORY = 30;

const MAX_FILES_PER_PAGE = 100;

export async function listFiles(
  supabase: SupabaseClient,
  userId: string
): Promise<FileEntry[]> {
  const { data, error } = await supabase
    .from("files")
    .select("id, name, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_FILES_PER_PAGE);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createFile(
  supabase: SupabaseClient,
  userId: string,
  name: string = "Untitled"
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("files")
    .insert({ user_id: userId, name })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function getFile(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<FileData | null> {
  const { data, error } = await supabase
    .from("files")
    .select("id, name, current_xml, history, messages, swing, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data as FileData;
}

export async function saveFile(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  patch: {
    name?: string;
    current_xml?: string | null;
    history?: HistoryEntry[];
    messages?: Message[];
    swing?: boolean | null;
  }
): Promise<void> {
  // Cap history at MAX_HISTORY
  const update: Record<string, unknown> = { ...patch };
  if (patch.history && patch.history.length > MAX_HISTORY) {
    update.history = patch.history.slice(-MAX_HISTORY);
  }

  const { error } = await supabase
    .from("files")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function deleteFile(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("files")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}
