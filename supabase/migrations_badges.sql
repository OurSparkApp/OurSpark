-- Badges schema + seed. Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.couple_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples (id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES public.badges (id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, badge_id)
);

CREATE INDEX IF NOT EXISTS couple_badges_couple_id_idx ON public.couple_badges (couple_id);

-- RLS (adjust to your auth model)
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badges_select_all" ON public.badges FOR SELECT USING (true);

CREATE POLICY "couple_badges_select_own" ON public.couple_badges FOR SELECT
  USING (
    couple_id IN (SELECT couple_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "couple_badges_insert_own" ON public.couple_badges FOR INSERT
  WITH CHECK (
    couple_id IN (SELECT couple_id FROM public.profiles WHERE id = auth.uid())
  );
