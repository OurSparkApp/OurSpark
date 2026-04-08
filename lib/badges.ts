import { supabase } from './supabase';

export const BADGE_SLUGS = [
  'first_spark',
  'streak_7',
  'streak_14',
  'streak_21',
  'streak_28',
  'night_owls',
  'early_birds',
  'in_sync',
  'vault_keeper',
] as const;

export type BadgeSlug = (typeof BADGE_SLUGS)[number];

export type BadgeRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
};

function parseAnswerTime(row: Record<string, unknown>): Date | null {
  const raw = row.submitted_at ?? row.created_at;
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isNightOwlLocal(d: Date): boolean {
  const h = d.getHours();
  return h >= 22 && h <= 23;
}

function isEarlyBirdLocal(d: Date): boolean {
  const h = d.getHours();
  return h >= 0 && h < 8;
}

async function fetchBadgeIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase.from('badges').select('id').eq('slug', slug).maybeSingle();
  if (error || !data?.id) {
    return null;
  }
  return String(data.id);
}

async function hasCoupleBadge(coupleId: string, badgeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('couple_badges')
    .select('id')
    .eq('couple_id', coupleId)
    .eq('badge_id', badgeId)
    .maybeSingle();
  if (error) {
    return false;
  }
  return Boolean(data);
}

async function insertCoupleBadge(
  coupleId: string,
  slug: string,
  onBadgeAwarded?: (badgeName: string) => void
): Promise<boolean> {
  const badgeId = await fetchBadgeIdBySlug(slug);
  if (!badgeId) {
    return false;
  }
  if (await hasCoupleBadge(coupleId, badgeId)) {
    return false;
  }
  const { data: badgeMeta } = await supabase.from('badges').select('name').eq('id', badgeId).maybeSingle();
  const { error } = await supabase.from('couple_badges').insert({
    couple_id: coupleId,
    badge_id: badgeId,
    earned_at: new Date().toISOString(),
  });
  if (error) {
    return false;
  }
  const name = typeof badgeMeta?.name === 'string' ? badgeMeta.name : slug;
  onBadgeAwarded?.(name);
  return true;
}

async function fetchTodayAnswersForQuestion(
  coupleId: string,
  questionId: string
): Promise<Record<string, unknown>[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const { data: bySubmitted } = await supabase
    .from('answers')
    .select('*')
    .eq('couple_id', coupleId)
    .eq('question_id', questionId)
    .gte('submitted_at', startIso)
    .lt('submitted_at', endIso);

  if (bySubmitted && bySubmitted.length > 0) {
    return bySubmitted as Record<string, unknown>[];
  }

  const { data: byCreated } = await supabase
    .from('answers')
    .select('*')
    .eq('couple_id', coupleId)
    .eq('question_id', questionId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);

  return (byCreated ?? []) as Record<string, unknown>[];
}

export type CheckAndAwardBadgesParams = {
  coupleId: string;
  userId: string;
  questionId: string;
  myText: string;
  theirText: string;
  isPerfectSync: boolean;
  streakAfterUpdate: number;
  onBadgeAwarded?: (badgeName: string) => void;
};

/**
 * Runs after a successful couple stats update on reveal (STATE 3).
 * Awards: First Spark, streak milestones, Night Owls, Early Birds, In Sync.
 */
async function isCouplePro(coupleId: string): Promise<boolean> {
  const { data } = await supabase.from('couples').select('is_pro').eq('id', coupleId).maybeSingle();
  return data?.is_pro === true;
}

export async function checkAndAwardBadges(params: CheckAndAwardBadgesParams): Promise<void> {
  const { coupleId, userId, questionId, isPerfectSync, streakAfterUpdate, onBadgeAwarded } = params;

  if (!coupleId || !questionId) {
    return;
  }

  const pro = await isCouplePro(coupleId);

  const rows = await fetchTodayAnswersForQuestion(coupleId, questionId);
  const mine = rows.find((r) => String(r.user_id ?? '') === userId);
  const partner = rows.find((r) => String(r.user_id ?? '') !== userId);
  if (!mine || !partner) {
    return;
  }

  const tMine = parseAnswerTime(mine);
  const tPartner = parseAnswerTime(partner);
  if (!tMine || !tPartner) {
    return;
  }

  if (isPerfectSync) {
    await insertCoupleBadge(coupleId, 'first_spark', onBadgeAwarded);
  }

  const streakMilestones: { slug: string; min: number }[] = [
    { slug: 'streak_7', min: 7 },
    { slug: 'streak_14', min: 14 },
    { slug: 'streak_21', min: 21 },
    { slug: 'streak_28', min: 28 },
  ];
  for (const { slug, min } of streakMilestones) {
    if (streakAfterUpdate >= min) {
      if (slug === 'streak_28' && !pro) {
        continue;
      }
      await insertCoupleBadge(coupleId, slug, onBadgeAwarded);
    }
  }

  if (pro && isNightOwlLocal(tMine) && isNightOwlLocal(tPartner)) {
    await insertCoupleBadge(coupleId, 'night_owls', onBadgeAwarded);
  }

  if (pro && isEarlyBirdLocal(tMine) && isEarlyBirdLocal(tPartner)) {
    await insertCoupleBadge(coupleId, 'early_birds', onBadgeAwarded);
  }

  const deltaMs = Math.abs(tMine.getTime() - tPartner.getTime());
  if (pro && deltaMs < 60_000) {
    await insertCoupleBadge(coupleId, 'in_sync', onBadgeAwarded);
  }
}

/** After first vault save (total count === 1 for couple). */
export async function awardVaultKeeperIfFirstSave(
  coupleId: string,
  onBadgeAwarded?: (badgeName: string) => void
): Promise<void> {
  const { count, error } = await supabase
    .from('vault')
    .select('*', { count: 'exact', head: true })
    .eq('couple_id', coupleId);

  if (error || count !== 1) {
    return;
  }
  if (!(await isCouplePro(coupleId))) {
    return;
  }
  await insertCoupleBadge(coupleId, 'vault_keeper', onBadgeAwarded);
}
