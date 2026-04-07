-- Run in Supabase SQL editor after creating tables (see comments in lib/badges.ts).
-- Badges catalog (9).

INSERT INTO public.badges (slug, name, description, icon) VALUES
  ('first_spark', 'First Spark', 'Your first perfect sync together', 'sparkles-outline'),
  ('streak_7', 'Week In Sync', 'Answered together 7 days in a row', 'flame-outline'),
  ('streak_14', 'Two Weeks Strong', 'Answered together 14 days in a row', 'flame-outline'),
  ('streak_21', 'Three Weeks Together', 'Answered together 21 days in a row', 'flame-outline'),
  ('streak_28', 'Month In Sync', 'Answered together 28 days in a row', 'flame-outline'),
  ('night_owls', 'Night Owls', 'Both answered between 10pm and midnight', 'moon-outline'),
  ('early_birds', 'Early Birds', 'Both answered between midnight and 8am', 'sunny-outline'),
  ('in_sync', 'In Sync', 'Submitted answers within one minute', 'sync-outline'),
  ('vault_keeper', 'Vault Keeper', 'Saved your first moment to the Vault', 'archive-outline')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon;
