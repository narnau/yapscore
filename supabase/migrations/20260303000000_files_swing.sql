-- Add per-file swing preference column.
-- NULL means "auto-detect from MusicXML markup"; true/false = user override.
alter table public.files add column if not exists swing boolean;
