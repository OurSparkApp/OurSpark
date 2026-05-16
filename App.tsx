import { Montserrat_400Regular } from '@expo-google-fonts/montserrat';
import { RedHatDisplay_700Bold } from '@expo-google-fonts/red-hat-display';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NavigationContainer,
  createNavigationContainerRef,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import ViewShot from 'react-native-view-shot';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import {
  registerForPushNotifications,
  scheduleQuestionNotification,
  sendRevealNotification,
} from './lib/notifications';
// DB migration for Expo push tokens (run in Supabase SQL editor):
// -- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token text;
import { awardVaultKeeperIfFirstSave, checkAndAwardBadges } from './lib/badges';
import { scheduledDateMatchesTodayMonthDay } from './lib/scheduledQuestion';
import {
  configureIapProductMaps,
  connectAndLoadProducts,
  getIapFormattedPrice,
  getPackProductIdToNameMap,
  isIapSupported,
  isProProductId,
  restoreIapPurchases,
  setIapPurchaseSettledHandler,
  startIapPurchase,
  syncProFromPurchaseHistory,
} from './lib/iap';
import { supabase } from './lib/supabase';

const IAP_PRODUCT_IDS = {
  proMonthly: 'com.ourspark.app.promonthly',
  proAnnual: 'com.ourspark.app.pro.annual',
  sillyPack: 'com.ourspark.app.sillypack',
  deepEnd: 'com.ourspark.app.deepend',
  dreamLife: 'com.ourspark.app.dreamlife',
  stillUs: 'com.ourspark.app.stilluspack',
  spicyPack: 'com.ourspark.app.spicypack',
  valentinesWeek: 'com.ourspark.app.valentinesweek',
  stayingWarm: 'com.ourspark.app.stayingwarm',
  summerHeat: 'com.ourspark.app.summerheat',
  fallingForYou: 'com.ourspark.app.fallingforyou',
  springForward: 'com.ourspark.app.springforward',
  newYearNewUs: 'com.ourspark.app.newyearnewus',
} as const;

const PRO_IAP_PRODUCT_IDS = [IAP_PRODUCT_IDS.proMonthly, IAP_PRODUCT_IDS.proAnnual];

const ALL_IAP_PRODUCT_IDS = Object.values(IAP_PRODUCT_IDS);

/** Maps App Store product IDs to `packs.name` in Supabase. */
const IAP_PACK_PRODUCT_ID_TO_PACK_NAME: Record<string, string> = {
  [IAP_PRODUCT_IDS.sillyPack]: 'Silly Pack',
  [IAP_PRODUCT_IDS.deepEnd]: 'The Deep End',
  [IAP_PRODUCT_IDS.dreamLife]: 'Dream Life Pack',
  [IAP_PRODUCT_IDS.stillUs]: 'Still Us Pack',
  [IAP_PRODUCT_IDS.spicyPack]: 'Spicy Pack',
  [IAP_PRODUCT_IDS.valentinesWeek]: "Valentine's Week",
  [IAP_PRODUCT_IDS.stayingWarm]: 'Staying Warm',
  [IAP_PRODUCT_IDS.summerHeat]: 'Summer Heat',
  [IAP_PRODUCT_IDS.fallingForYou]: 'Falling For You',
  [IAP_PRODUCT_IDS.springForward]: 'Spring Forward',
  [IAP_PRODUCT_IDS.newYearNewUs]: 'New Year, New Us',
};

const PACK_NAME_TO_IAP_PRODUCT_ID: Record<string, string> = Object.fromEntries(
  Object.entries(IAP_PACK_PRODUCT_ID_TO_PACK_NAME).map(([productId, packName]) => [packName, productId])
);

function getPackIapProductId(packName: string): string {
  return PACK_NAME_TO_IAP_PRODUCT_ID[packName] ?? '';
}

configureIapProductMaps(PRO_IAP_PRODUCT_IDS, IAP_PACK_PRODUCT_ID_TO_PACK_NAME);

const checkIsPro = async (coupleId: string): Promise<boolean> => {
  const { data } = await supabase.from('couples').select('is_pro').eq('id', coupleId).maybeSingle();
  return data?.is_pro === true;
};

/** Free tier: earnable without Pro (matches product names in UI). */
const FREE_BADGE_SLUGS = new Set(['first_spark', 'streak_7', 'streak_14', 'streak_21']);

/** Show the small "PRO" label only when locked and `badges.name` matches (must match DB display names). */
const PRO_LABEL_BADGE_NAMES = new Set([
  'One Month In Sync',
  'Night Owls',
  'Early Birds',
  'In Sync',
  'Vault Keeper',
]);

const NAVY = '#090236';
const BG = '#F1E9D2';
const LINEN = '#FAF6EE';
const BORDER = '#E8DFC8';
const PURPLE = '#841C67';
const SAGE = '#7D9E8C';
const CARD_BG = LINEN;
const TEXT = NAVY;
const TEXT_ON_DARK = '#F1E9D2';
/** Dark surfaces (Wrapped modal, share cards) — navy is background only here. */
const DARK_BG = '#090236';
const DARK_CARD = '#0D0845';
const CORAL_CTA = SAGE;
const ORANGE = SAGE;

function formatReflectionFreeTier(text: string): { preview: string; isTruncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { preview: '', isTruncated: false };
  }
  const parts = trimmed.split('. ').filter((p) => p.length > 0);
  if (parts.length <= 2) {
    return { preview: trimmed, isTruncated: false };
  }
  return { preview: `${parts.slice(0, 2).join('. ')}.`, isTruncated: true };
}

type MainTabParamList = {
  Dashboard: undefined;
  Question: undefined;
  Packs: undefined;
  Vault: undefined;
  Badges: undefined;
};

const navigationRef = createNavigationContainerRef<MainTabParamList>();

const FONT_HEADING = 'RedHatDisplay_700Bold';
const FONT_BODY = 'Montserrat_400Regular';
const HOME_LOGO = require('./assets/transparent_dark_font.png');

const Tab = createBottomTabNavigator();
type AppStage = 'marketing' | 'auth' | 'personalization' | 'invite' | 'main';

function getQuestionCycleDate(date: Date): Date {
  const cycleDate = new Date(date);
  if (cycleDate.getHours() < 4) {
    cycleDate.setDate(cycleDate.getDate() - 1);
  }
  return cycleDate;
}

/** Local calendar date key for the OurSpark "day" (rolls at 4am local). */
function formatLocalDateKey(ref: Date = new Date()): string {
  const cycleDate = getQuestionCycleDate(ref);
  const year = cycleDate.getFullYear();
  const month = `${cycleDate.getMonth() + 1}`.padStart(2, '0');
  const day = `${cycleDate.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Normalize `couples.last_answered_date` from DB (date or timestamptz) to YYYY-MM-DD for comparisons. */
function coupleDateKeyFromDbValue(value: unknown): string {
  const s = String(value ?? '').trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return s;
}

const DASHBOARD_COUPLE_STATS_REFRESH = 'ourspark:dashboardCoupleStatsRefresh';

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function readQuestionTextFromRow(questionRow: Record<string, unknown>): string | null {
  const candidates = [
    questionRow.question,
    questionRow.question_text,
    questionRow.text,
    questionRow.prompt,
    questionRow.title,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readAnswerTextFromRow(answerRow: Record<string, unknown>): string {
  const candidates = [
    answerRow.answer_text,
    answerRow.answer,
    answerRow.response_text,
    answerRow.text,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

async function resolveTodayQuestionRow(ref: Date = new Date()): Promise<Record<string, unknown> | null> {
  const questionCycleDate = getQuestionCycleDate(ref);

  const { data: allQuestions, error: allQuestionsError } = await supabase.from('questions').select('*');

  if (allQuestionsError || !allQuestions || allQuestions.length === 0) {
    return null;
  }

  const scheduledMatch = allQuestions.find((row) => {
    const rowMap = row as Record<string, unknown>;
    if (rowMap.scheduled_date == null) {
      return false;
    }
    if (!scheduledDateMatchesTodayMonthDay(rowMap.scheduled_date, questionCycleDate)) {
      return false;
    }
    return Boolean(readQuestionTextFromRow(rowMap));
  });

  if (scheduledMatch) {
    return scheduledMatch as Record<string, unknown>;
  }

  const validQuestions = allQuestions
    .map((row) => {
      const rowMap = row as Record<string, unknown>;
      return { row: rowMap, text: readQuestionTextFromRow(rowMap) };
    })
    .filter((item): item is { row: Record<string, unknown>; text: string } => Boolean(item.text));

  if (validQuestions.length === 0) {
    return null;
  }

  const questionIndex = Math.abs(getDayOfYear(questionCycleDate) % validQuestions.length);
  return validQuestions[questionIndex].row;
}

/** Start/end instants for the local OurSpark day window [4am local, next day 4am local). */
function getLocalDayBounds(ref: Date = new Date()): { startIso: string; endIso: string } {
  const cycleDate = getQuestionCycleDate(ref);
  const y = cycleDate.getFullYear();
  const m = cycleDate.getMonth();
  const d = cycleDate.getDate();
  const start = new Date(y, m, d, 4, 0, 0, 0);
  const end = new Date(y, m, d + 1, 4, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Today's answers for this couple + question (local calendar day). Prefers submitted_at; falls back to created_at. */
async function fetchTodayAnswersRows(
  activeCoupleId: string,
  activeQuestionId: string,
  refTime: Date = new Date()
): Promise<Record<string, unknown>[]> {
  const { startIso, endIso } = getLocalDayBounds(refTime);

  const fetchByColumn = async (column: 'submitted_at' | 'created_at') => {
    const { data, error } = await supabase
      .from('answers')
      .select('*')
      .eq('couple_id', activeCoupleId)
      .eq('question_id', activeQuestionId)
      .gte(column, startIso)
      .lt(column, endIso);
    if (error) {
      return null;
    }
    return (data ?? []) as Record<string, unknown>[];
  };

  const bySubmitted = await fetchByColumn('submitted_at');
  if (bySubmitted === null) {
    return (await fetchByColumn('created_at')) ?? [];
  }
  if (bySubmitted.length > 0) {
    return bySubmitted;
  }
  return (await fetchByColumn('created_at')) ?? [];
}

type TodaysQuestionForAnswersResult = {
  questionId: string | null;
  selectedQuestion: Record<string, unknown> | null;
  questionText: string;
};

/**
 * Single resolver for today's question row + id + display text (active pack / Spicy / pool).
 * Dashboard and Today tab must use this so `question_id` in `answers` always matches.
 */
async function resolveTodaysQuestionForCoupleAnswers(
  coupleId: string,
  userId: string,
  opts?: { activePackData?: Record<string, unknown> | null; now?: Date }
): Promise<TodaysQuestionForAnswersResult> {
  const now = opts?.now ?? new Date();

  let activePackData: Record<string, unknown> | null = null;
  if (opts !== undefined && opts.activePackData !== undefined) {
    activePackData = opts.activePackData;
  } else {
    const { data } = await supabase
      .from('couple_packs')
      .select('*, packs(*)')
      .eq('couple_id', coupleId)
      .eq('status', 'active')
      .maybeSingle();
    activePackData = (data ?? null) as Record<string, unknown> | null;
  }

  if (!activePackData) {
    const row = await resolveTodayQuestionRow(now);
    const id = row?.id != null ? String(row.id) : null;
    const text = row ? (readQuestionTextFromRow(row) ?? '') : '';
    return { questionId: id, selectedQuestion: row, questionText: text };
  }

  const ap = activePackData;
  const packId = ap.pack_id != null ? String(ap.pack_id) : '';
  const day = Math.max(1, Number(ap.current_day ?? 1));
  const packsRaw = ap.packs;
  const packMeta =
    Array.isArray(packsRaw) && packsRaw.length > 0
      ? (packsRaw[0] as Record<string, unknown>)
      : (packsRaw as Record<string, unknown> | null);
  const packName = typeof packMeta?.name === 'string' ? packMeta.name : '';

  if (packName === 'Spicy Pack') {
    const todayKey = formatLocalDateKey(now);
    const { data: levelPicks } = await supabase
      .from('spicy_level_picks')
      .select('user_id, level')
      .eq('couple_id', coupleId)
      .eq('pick_date', todayKey);
    const pickRows = (levelPicks ?? []) as Record<string, unknown>[];
    const myPick = pickRows.find((r) => String(r.user_id ?? '') === userId);
    const partnerPick = pickRows.find((r) => String(r.user_id ?? '') !== userId);
    const myLevel = typeof myPick?.level === 'string' ? myPick.level : null;
    const partnerLevel = typeof partnerPick?.level === 'string' ? partnerPick.level : null;
    if (!myLevel || !partnerLevel) {
      return { questionId: null, selectedQuestion: null, questionText: '' };
    }

    const { startIso, endIso } = getLocalDayBounds(now);
    const { data: usedToday } = await supabase
      .from('spicy_questions_used')
      .select('spicy_question_id, created_at')
      .eq('couple_id', coupleId)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: false })
      .limit(1);
    const usedRow = usedToday?.[0] as Record<string, unknown> | undefined;
    const spicyQid = usedRow?.spicy_question_id;
    if (spicyQid == null || !String(spicyQid)) {
      return { questionId: null, selectedQuestion: null, questionText: '' };
    }
    const sid = String(spicyQid);
    const { data: sq } = await supabase.from('spicy_questions').select('*').eq('id', sid).maybeSingle();
    const row = (sq ?? null) as Record<string, unknown> | null;
    const text = row
      ? (typeof row.question_text === 'string' && row.question_text.trim()) ||
        (typeof row.question === 'string' && row.question.trim()) ||
        (typeof row.prompt === 'string' && row.prompt.trim()) ||
        ''
      : '';
    return { questionId: sid, selectedQuestion: row, questionText: typeof text === 'string' ? text : '' };
  }

  const { data: packQuestion } = await supabase
    .from('pack_questions')
    .select('*')
    .eq('pack_id', packId)
    .eq('day_number', day)
    .maybeSingle();

  if (packQuestion && (packQuestion as Record<string, unknown>).id != null) {
    const pq = packQuestion as Record<string, unknown>;
    const questionText =
      (typeof pq.question_text === 'string' && pq.question_text.trim()) ||
      (typeof pq.question === 'string' && pq.question.trim()) ||
      (typeof pq.prompt === 'string' && pq.prompt.trim()) ||
      '';
    if (questionText) {
      return { questionId: String(pq.id), selectedQuestion: pq, questionText };
    }
  }

  const poolRow = await resolveTodayQuestionRow(now);
  const id = poolRow?.id != null ? String(poolRow.id) : null;
  const text = poolRow ? (readQuestionTextFromRow(poolRow) ?? '') : '';
  return { questionId: id, selectedQuestion: poolRow, questionText: text };
}

function getGreetingPrefix(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) {
    return 'Good morning';
  }
  if (h >= 12 && h < 17) {
    return 'Good afternoon';
  }
  if (h >= 17 && h < 22) {
    return 'Good evening';
  }
  return 'Hey';
}

const PARTNER_PHRASE_FALLBACK = 'your partner';
const PARTNER_HEADING_FALLBACK = 'Your partner';
const USER_GREETING_FALLBACK = 'friend';

function profileDisplayNameFromRow(row: Record<string, unknown> | null | undefined): string {
  if (!row) {
    return '';
  }
  for (const key of ['name', 'first_name', 'full_name'] as const) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

function isUnusableFirstNameToken(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) {
    return true;
  }
  return new Set(['your', 'there', 'partner', 'hey', 'hi', 'dear', 'null', 'undefined']).has(t);
}

/** Lowercase mid-sentence, e.g. "Waiting for {name}'s answer" */
function partnerPossessivePhraseName(row: Record<string, unknown> | null | undefined): string {
  const full = profileDisplayNameFromRow(row);
  const first = full.split(/\s+/).filter(Boolean)[0] ?? '';
  if (isUnusableFirstNameToken(first)) {
    return PARTNER_PHRASE_FALLBACK;
  }
  return first;
}

/** Title-style first name for headings ("Alex said:") or PARTNER_HEADING_FALLBACK */
function partnerHeadingFirstName(row: Record<string, unknown> | null | undefined): string {
  const p = partnerPossessivePhraseName(row);
  return p === PARTNER_PHRASE_FALLBACK ? PARTNER_HEADING_FALLBACK : p;
}

function userGreetingFirstName(
  profileRow: Record<string, unknown> | null | undefined,
  authMetadata: Record<string, unknown> | undefined
): string {
  let full = profileDisplayNameFromRow(profileRow);
  if (!full && authMetadata) {
    const fromMeta =
      typeof authMetadata.first_name === 'string'
        ? authMetadata.first_name.trim()
        : typeof authMetadata.name === 'string'
          ? authMetadata.name.trim()
          : '';
    full = fromMeta;
  }
  const first = full.split(/\s+/).filter(Boolean)[0] ?? '';
  if (isUnusableFirstNameToken(first)) {
    return '';
  }
  return first;
}

async function fetchPartnerProfileRow(
  coupleId: string,
  currentUserId: string
): Promise<Record<string, unknown> | null> {
  console.log('[partnerName] querying partner profile', { coupleId, currentUserId });
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('couple_id', coupleId)
    .neq('id', currentUserId);

  if (error) {
    console.log('[partnerName] partner query error', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      coupleId,
      currentUserId,
    });
    return null;
  }

  if (!data || data.length === 0) {
    console.log('[partnerName] no partner profile rows returned', { coupleId, currentUserId });
    return null;
  }

  const rows = data as Record<string, unknown>[];
  const named = rows.find((row) => {
    const first = partnerHeadingFirstName(row);
    return first !== PARTNER_HEADING_FALLBACK;
  });
  return named ?? rows[0] ?? null;
}

function formatTodayLong(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Monday 00:00 UTC as YYYY-MM-DD - matches `generate-reflection` Edge Function `week_starting`. */
function getCurrentWeekMondayDateKeyUTC(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getGenerateReflectionInvokeUrl(): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  if (!base) {
    return null;
  }
  return `${base}/functions/v1/generate-reflection`;
}

const ANSWER_MATCH_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'i',
  'my',
  'our',
  'we',
  'you',
  'it',
  'of',
  'to',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
]);

function normalizeAnswerForMatch(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenizeAnswerForMatch(text: string): string[] {
  const normalized = normalizeAnswerForMatch(text);
  return normalized
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['']+|['']+$/g, ''))
    .filter((w) => w.length > 0 && !ANSWER_MATCH_STOP_WORDS.has(w));
}

function wordsForConsecutivePhrase(text: string): string[] {
  return normalizeAnswerForMatch(text)
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9'-]/gi, ''))
    .filter((w) => w.length > 0);
}

function hasThreeConsecutiveMatchingWords(a: string, b: string): boolean {
  const wa = wordsForConsecutivePhrase(a);
  const wb = wordsForConsecutivePhrase(b);
  if (wa.length < 3 || wb.length < 3) {
    return false;
  }
  for (let i = 0; i <= wa.length - 3; i++) {
    for (let j = 0; j <= wb.length - 3; j++) {
      if (wa[i] === wb[j] && wa[i + 1] === wb[j + 1] && wa[i + 2] === wb[j + 2]) {
        return true;
      }
    }
  }
  return false;
}

function levenshteinDistance(s: string, t: string): number {
  const m = s.length;
  const n = t.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  const v0 = new Array<number>(n + 1);
  const v1 = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) {
    v0[j] = j;
  }
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < n; j++) {
      const cost = s.charCodeAt(i) === t.charCodeAt(j) ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= n; j++) {
      v0[j] = v1[j];
    }
  }
  return v0[n];
}

function answerSimilarityRatio(a: string, b: string): number {
  const s = normalizeAnswerForMatch(a);
  const t = normalizeAnswerForMatch(b);
  if (s.length === 0 && t.length === 0) {
    return 1;
  }
  if (s.length === 0 || t.length === 0) {
    return 0;
  }
  const d = levenshteinDistance(s, t);
  return 1 - d / Math.max(s.length, t.length);
}

function countMatchingWordsBetweenAnswers(a: string, b: string): number {
  const wordsA = new Set(tokenizeAnswerForMatch(a));
  const wordsB = new Set(tokenizeAnswerForMatch(b));
  let count = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) {
      count++;
    }
  }
  return count;
}

type AnswerMatchTier = 'perfect' | 'close' | 'interesting';

function getAnswerMatchMeta(a: string, b: string): {
  tier: AnswerMatchTier;
  filledCircles: number;
  label: string;
  matchWordCount: number;
  labelColor: string;
} {
  const matchWordCount = countMatchingWordsBetweenAnswers(a, b);
  const na = normalizeAnswerForMatch(a);
  const nb = normalizeAnswerForMatch(b);
  const bothNonEmpty = na.length > 0 && nb.length > 0;
  const isPerfect =
    bothNonEmpty &&
    (hasThreeConsecutiveMatchingWords(a, b) || answerSimilarityRatio(a, b) > 0.8);
  if (isPerfect) {
    return {
      tier: 'perfect',
      filledCircles: 5,
      label: 'Perfect Sync',
      matchWordCount,
      labelColor: ORANGE,
    };
  }
  if (matchWordCount >= 1) {
    return {
      tier: 'close',
      filledCircles: 3,
      label: 'Close Call',
      matchWordCount,
      labelColor: PURPLE,
    };
  }
  return {
    tier: 'interesting',
    filledCircles: 2,
    label: 'Interesting...',
    matchWordCount,
      labelColor: TEXT_ON_DARK,
  };
}

/** Weekly streak milestones: 7, 14, 21, … (every 7 days). */
function isWeeklyStreakMilestone(streak: number): boolean {
  return streak >= 7 && streak % 7 === 0;
}

/** Milestone share card heading (CARD 2). */
function getMilestoneCardHeading(streak: number): string {
  switch (streak) {
    case 7:
      return 'One Week In Sync';
    case 14:
      return 'Two Weeks Strong';
    case 21:
      return 'Three Weeks Together';
    case 28:
      return 'One Month In Sync';
    default:
      return `${streak / 7} Weeks Connected`;
  }
}

type MilestoneData = { streak: number; partnerName: string };

function HomeButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.92} style={styles.homeCtaButton} onPress={onPress}>
      <Text style={styles.homeCtaText}>{label}</Text>
    </TouchableOpacity>
  );
}

function MarketingHomeScreen({
  onBeginOurStory,
  onSignIn,
}: {
  onBeginOurStory: () => void;
  onSignIn: () => void;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.homeInner}>
        <View style={styles.homeTopSection}>
          <Image source={HOME_LOGO} style={styles.homeLogo} resizeMode="contain" />
          <Text style={styles.tagline}>{"Keep the Spark"}</Text>
        </View>
        <View style={styles.homeBottomSection}>
          <HomeButton label="Begin Our Story" onPress={onBeginOurStory} />
          <Text style={styles.caption}>Join 1,000+ couples already connecting</Text>
          <TouchableOpacity activeOpacity={0.8} onPress={onSignIn}>
            <Text style={styles.authSwitchText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

type DailyQuestionStatus = 'not_answered' | 'waiting' | 'reveal_ready';

const WRAPPED_CORAL = SAGE;
const WRAPPED_HUMOUR_DEFAULT =
  'You two answered within 60 seconds of each other more than once this year. Were you sitting next to each other?';
const WRAPPED_HUMOUR_WITTY = "If that wasn't on purpose, the universe is playing matchmaker.";

type WrappedCategory = 'feels' | 'memory' | 'rightNow' | 'playful';

type WrappedData = {
  year: number;
  compatibilityScore: number;
  longestStreak: number;
  bestQuestion: string;
  bestAnswer1: string;
  bestAnswer2: string;
  topCategory: WrappedCategory;
  relationshipWord: string;
  humourStat: string;
};

const WRAPPED_CATEGORY_COPY: Record<
  WrappedCategory,
  { title: string; description: string }
> = {
  feels: {
    title: 'Feels People',
    description:
      'You go deep. You asked the hard questions and showed up for the answers. That takes courage - and you did it together.',
  },
  memory: {
    title: 'Memory People',
    description:
      "You live in the good ones. All year you kept reaching back for the moments that made you. That's not nostalgia - that's knowing what matters.",
  },
  rightNow: {
    title: 'Right Now People',
    description:
      "You're present. While everyone else was distracted you kept asking - how are you, really? Your partner felt that.",
  },
  playful: {
    title: 'Playful People',
    description: 'You still make each other laugh. After everything - you still chose fun. Never stop.',
  },
};

function parseScheduledMonthDayForWrapped(raw: unknown): { month: number; day: number } | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (ymd) {
      return { month: Number.parseInt(ymd[2], 10), day: Number.parseInt(ymd[3], 10) };
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return { month: d.getMonth() + 1, day: d.getDate() };
    }
    return null;
  }
  if (raw instanceof Date) {
    return { month: raw.getMonth() + 1, day: raw.getDate() };
  }
  return null;
}

function categoryBucketFromScheduledDate(raw: unknown): WrappedCategory | null {
  const md = parseScheduledMonthDayForWrapped(raw);
  if (!md) {
    return null;
  }
  const ref = new Date(2024, md.month - 1, md.day);
  if (Number.isNaN(ref.getTime())) {
    return null;
  }
  const doy = getDayOfYear(ref);
  const r = ((doy % 4) + 4) % 4;
  if (r === 0) {
    return 'feels';
  }
  if (r === 1) {
    return 'memory';
  }
  if (r === 2) {
    return 'rightNow';
  }
  return 'playful';
}

function syncScoreWrappedCopy(score: number): string {
  if (score >= 80) {
    return "Either you're soulmates or one of you is psychic. Either way, we're impressed.";
  }
  if (score >= 60) {
    return 'In sync, with just enough mystery to keep things interesting.';
  }
  if (score >= 40) {
    return "Opposites who keep choosing each other. That's actually the good stuff.";
  }
  return "Turns out opposites don't just attract - they stick around.";
}

function isValentinesDayLocal(): boolean {
  const d = new Date();
  return d.getMonth() === 1 && d.getDate() === 14;
}

async function fetchWrappedData(
  coupleId: string,
  activeUserId: string,
  year: number
): Promise<WrappedData> {
  const counts: Record<WrappedCategory, number> = {
    feels: 0,
    memory: 0,
    rightNow: 0,
    playful: 0,
  };

  const startIso = `${year}-01-01T00:00:00.000Z`;
  const endIso = `${year + 1}-01-01T00:00:00.000Z`;

  const { data: coupleRow } = await supabase
    .from('couples')
    .select('compatibility_score, longest_streak')
    .eq('id', coupleId)
    .maybeSingle();

  const compatibilityScore = Math.min(
    100,
    Math.max(0, Math.round(Number(coupleRow?.compatibility_score ?? 0)))
  );
  const longestStreak = Math.max(0, Math.round(Number(coupleRow?.longest_streak ?? 0)));

  let bestQuestion = 'Your next Perfect Sync is waiting.';
  let bestAnswer1 = '-';
  let bestAnswer2 = '-';

  const { data: vaultRows } = await supabase
    .from('vault')
    .select('*')
    .eq('couple_id', coupleId)
    .order('saved_at', { ascending: false })
    .limit(1);

  const vaultRow = vaultRows?.[0] as Record<string, unknown> | undefined;
  if (vaultRow?.question_id != null) {
    const qid = String(vaultRow.question_id);
    const { data: qRow } = await supabase.from('questions').select('*').eq('id', qid).maybeSingle();
    const qt = qRow ? readQuestionTextFromRow(qRow as Record<string, unknown>) : null;
    if (qt) {
      bestQuestion = qt;
    }

    const { data: ansRows } = await supabase
      .from('answers')
      .select('*')
      .eq('couple_id', coupleId)
      .eq('question_id', qid);

    const rows = (ansRows ?? []) as Record<string, unknown>[];
    const mine = rows.find((r) => String(r.user_id ?? '') === activeUserId);
    const partner = rows.find((r) => String(r.user_id ?? '') !== activeUserId);
    const t1 = readAnswerTextFromRow(mine ?? {});
    const t2 = readAnswerTextFromRow(partner ?? {});
    bestAnswer1 = t1 || '-';
    bestAnswer2 = t2 || '-';
  }

  const { data: yearAnswers } = await supabase
    .from('answers')
    .select('question_id')
    .eq('couple_id', coupleId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);

  const qIds = [
    ...new Set(
      (yearAnswers ?? [])
        .map((a) => String((a as Record<string, unknown>).question_id ?? ''))
        .filter(Boolean)
    ),
  ];

  if (qIds.length > 0) {
    const { data: questionRows } = await supabase.from('questions').select('*').in('id', qIds);
    const qMap = new Map<string, Record<string, unknown>>();
    (questionRows ?? []).forEach((q) => {
      const m = q as Record<string, unknown>;
      if (m.id != null) {
        qMap.set(String(m.id), m);
      }
    });

    for (const a of yearAnswers ?? []) {
      const qid = String((a as Record<string, unknown>).question_id ?? '');
      const q = qMap.get(qid);
      if (!q) {
        continue;
      }
      const bucket = categoryBucketFromScheduledDate(q.scheduled_date);
      if (bucket) {
        counts[bucket] += 1;
      }
    }
  }

  const order: WrappedCategory[] = ['feels', 'memory', 'rightNow', 'playful'];
  let topCategory: WrappedCategory = 'feels';
  let best = -1;
  for (const k of order) {
    if (counts[k] > best) {
      best = counts[k];
      topCategory = k;
    }
  }

  return {
    year,
    compatibilityScore,
    longestStreak,
    bestQuestion,
    bestAnswer1,
    bestAnswer2,
    topCategory,
    relationshipWord: 'Growth',
    humourStat: WRAPPED_HUMOUR_DEFAULT,
  };
}

function emptyWrappedData(year: number): WrappedData {
  return {
    year,
    compatibilityScore: 0,
    longestStreak: 0,
    bestQuestion: 'Your next Perfect Sync is waiting.',
    bestAnswer1: '-',
    bestAnswer2: '-',
    topCategory: 'feels',
    relationshipWord: 'Growth',
    humourStat: WRAPPED_HUMOUR_DEFAULT,
  };
}

function WrappedTeaserModal({
  visible,
  onClose,
  onUnlock,
}: {
  visible: boolean;
  onClose: () => void;
  onUnlock: () => void;
}) {
  const insets = useSafeAreaInsets();
  const year = new Date().getFullYear();

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.wrappedTeaserRoot, { backgroundColor: DARK_BG, paddingTop: insets.top }]}>
        <TouchableOpacity
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.wrappedTeaserClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close-outline" size={28} color={TEXT_ON_DARK} />
        </TouchableOpacity>

        <View style={styles.wrappedTeaserContent}>
          <Image source={HOME_LOGO} style={styles.wrappedTeaserLogo} resizeMode="contain" />
          <Text style={styles.wrappedTeaserHeadline}>Your {year} Spark Story is ready.</Text>
          <Text style={styles.wrappedTeaserSub}>
            Your love story is ready. Unlock Wrapped to see your year.
          </Text>
          <View style={styles.wrappedTeaserBlursRow}>
            <View style={styles.wrappedTeaserBlurCard} />
            <View style={styles.wrappedTeaserBlurCard} />
            <View style={styles.wrappedTeaserBlurCard} />
          </View>
          <TouchableOpacity activeOpacity={0.9} style={styles.wrappedTeaserCta} onPress={onUnlock}>
            <Text style={styles.wrappedTeaserCtaText}>Unlock Everything - for both of you</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function OurSparkWrappedModal({
  visible,
  onClose,
  data,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  data: WrappedData | null;
  loading: boolean;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerH = insets.top + 56;
  const cardH = Math.max(400, screenH - headerH);
  const [pageIndex, setPageIndex] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const shotRefs = useRef<(ViewShot | null)[]>([null, null, null, null, null, null]);

  useEffect(() => {
    if (visible) {
      setPageIndex(0);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
      });
    }
  }, [visible]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.round(x / screenW);
    if (next !== pageIndex && next >= 0 && next <= 6) {
      setPageIndex(next);
    }
  };

  const saveCard = async (shotIndex: number) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Please allow access to your camera roll in Settings.');
        return;
      }
      const shot = shotRefs.current[shotIndex];
      if (!shot?.capture) {
        Alert.alert('Could not capture the card. Please try again.');
        return;
      }
      const uri = await shot.capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch {
      Alert.alert('Could not save the image. Please try again.');
    }
  };

  const d = data ?? emptyWrappedData(new Date().getFullYear());
  const cat = WRAPPED_CATEGORY_COPY[d.topCategory];
  const footerUrlStyle = { fontFamily: FONT_BODY, fontSize: 11 } as const;

  const saveBtn = (shotIndex: number, lightIcon: boolean) => (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.wrappedSaveBtn, { bottom: insets.bottom + 16 }]}
      onPress={() => void saveCard(shotIndex)}
    >
      <Ionicons name="download-outline" size={20} color={lightIcon ? TEXT_ON_DARK : DARK_BG} />
    </TouchableOpacity>
  );

  const cardShell = (
    key: string,
    bg: string,
    children: React.ReactNode,
    shotWrap: boolean,
    shotIndex: number,
    showSave: boolean,
    saveIconLight: boolean
  ) => {
    const inner = (
      <View style={[styles.wrappedCardInner, { width: screenW, height: cardH, backgroundColor: bg }]}>
        {children}
        {showSave ? saveBtn(shotIndex, saveIconLight) : null}
      </View>
    );
    if (!shotWrap) {
      return <View key={key}>{inner}</View>;
    }
    return (
      <View key={key} style={{ width: screenW }}>
        <ViewShot
          ref={(r) => {
            shotRefs.current[shotIndex] = r;
          }}
          style={{ width: screenW, height: cardH }}
          options={{ format: 'png' }}
        >
          {inner}
        </ViewShot>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.wrappedModalRoot, { backgroundColor: DARK_BG }]}>
        <View style={[styles.wrappedHeaderBar, { paddingTop: insets.top + 8, minHeight: headerH }]}>
          <View style={styles.wrappedHeaderSide} />
          <View style={styles.wrappedDotsRow}>
            {Array.from({ length: 7 }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.wrappedDot,
                  {
                    backgroundColor: i === pageIndex ? ORANGE : PURPLE,
                    opacity: i === pageIndex ? 1 : 0.3,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.wrappedHeaderSide}>
            <TouchableOpacity
              accessibilityLabel="Close Wrapped"
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close-outline" size={28} color={TEXT_ON_DARK} />
            </TouchableOpacity>
          </View>
        </View>

        {savedFlash ? (
          <View style={styles.wrappedSavedToast} pointerEvents="none">
            <Text style={styles.wrappedSavedToastText}>Saved!</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={[styles.wrappedLoading, { height: cardH }]}>
            <ActivityIndicator size="large" color={ORANGE} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
          >
            {cardShell(
              'w0',
              DARK_BG,
              <View style={styles.wrappedCoverWrap}>
                <View
                  pointerEvents="none"
                  style={[styles.wrappedGlowTL, { backgroundColor: PURPLE, top: -80, right: -100 }]}
                />
                <View
                  pointerEvents="none"
                  style={[styles.wrappedGlowBR, { backgroundColor: WRAPPED_CORAL, bottom: -100, left: -80 }]}
                />
                <Image source={HOME_LOGO} style={styles.wrappedCoverLogo} resizeMode="contain" />
                <Text style={[styles.wrappedCoverYear, { fontFamily: FONT_BODY, color: TEXT_ON_DARK }]}>
                  Your {d.year}
                </Text>
                <Text style={[styles.wrappedCoverTitle, { fontFamily: FONT_HEADING, color: TEXT_ON_DARK }]}>
                  Spark Story
                </Text>
                <View style={[styles.wrappedDividerOrange, { backgroundColor: WRAPPED_CORAL }]} />
                <Text style={[styles.wrappedCoverTag, { fontFamily: FONT_BODY, color: TEXT_ON_DARK }]}>
                  {"Keep the Spark"}
                </Text>
                <Text style={[styles.wrappedSwipeHint, { fontFamily: FONT_BODY, color: ORANGE }]}>
                  Swipe to begin
                </Text>
                <Ionicons name="chevron-forward-outline" size={22} color={ORANGE} style={styles.wrappedChevron} />
              </View>,
              false,
              0,
              false,
              true
            )}

            {cardShell(
              'w1',
              DARK_BG,
              <View style={styles.wrappedCardPad}>
                <Text
                  style={[
                    styles.wrappedLabelPurple,
                    { fontFamily: FONT_BODY, color: PURPLE, paddingTop: 100 },
                  ]}
                >
                  YOUR SYNC SCORE
                </Text>
                <View style={styles.wrappedScoreRow}>
                  <Text style={[styles.wrappedScoreBig, { fontFamily: FONT_HEADING, color: ORANGE }]}>
                    {d.compatibilityScore}
                  </Text>
                  <Text style={[styles.wrappedScorePct, { fontFamily: FONT_HEADING, color: ORANGE }]}>%</Text>
                </View>
                <Text style={[styles.wrappedSyncSubtext, { fontFamily: FONT_BODY, color: TEXT_ON_DARK }]}>
                  {syncScoreWrappedCopy(d.compatibilityScore)}
                </Text>
                <Text style={[styles.wrappedAbsFooter, footerUrlStyle, { color: PURPLE }]}>
                  oursparkapp.com
                </Text>
              </View>,
              true,
              0,
              true,
              true
            )}

            {cardShell(
              'w2',
              LINEN,
              <View style={styles.wrappedCardPad}>
                <Text
                  style={[
                    styles.wrappedLabelPurple,
                    { fontFamily: FONT_BODY, color: PURPLE, paddingTop: 80 },
                  ]}
                >
                  PERFECT SYNC MOMENT
                </Text>
                <Text style={[styles.wrappedMomentIntro, { fontFamily: FONT_BODY, color: BG }]}>
                  Out of every question this year, this one stopped us in our tracks.
                </Text>
                <Text style={[styles.wrappedMomentQuestion, { fontFamily: FONT_HEADING, color: BG }]}>
                  {d.bestQuestion}
                </Text>
                <View style={styles.wrappedAnswersRow}>
                  <View style={[styles.wrappedAnsCardLeft, { backgroundColor: DARK_BG }]}>
                    <Text style={[styles.wrappedAnsTextLight, { fontFamily: FONT_BODY, color: TEXT_ON_DARK }]}>
                      {d.bestAnswer1}
                    </Text>
                  </View>
                  <View style={[styles.wrappedAnsCardRight, { backgroundColor: PURPLE }]}>
                    <Text style={[styles.wrappedAnsTextLight, { fontFamily: FONT_BODY, color: '#FFFFFF' }]}>
                      {d.bestAnswer2}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.wrappedMomentFooter, { fontFamily: FONT_BODY, color: PURPLE }]}>
                  You didn&apos;t plan that. You just both felt it.
                </Text>
                <Text style={[styles.wrappedAbsFooter, footerUrlStyle, { color: PURPLE }]}>
                  oursparkapp.com
                </Text>
              </View>,
              true,
              1,
              true,
              false
            )}

            {cardShell(
              'w3',
              SAGE,
              <View style={styles.wrappedCardPad}>
                <Text
                  style={[
                    styles.wrappedLabelPurple,
                    {
                      fontFamily: FONT_BODY,
                      color: 'rgba(255,255,255,0.6)',
                      paddingTop: 100,
                    },
                  ]}
                >
                  YOUR STREAK RECORD
                </Text>
                <Text style={styles.wrappedFlame}>🔥</Text>
                <Text style={[styles.wrappedStreakNum, { fontFamily: FONT_HEADING, color: '#FFFFFF' }]}>
                  {d.longestStreak}
                </Text>
                <Text style={[styles.wrappedDaysLbl, { fontFamily: FONT_BODY, color: 'rgba(255,255,255,0.8)' }]}>
                  days
                </Text>
                <Text
                  style={[
                    styles.wrappedBodyCenter,
                    {
                      fontFamily: FONT_BODY,
                      color: 'rgba(255,255,255,0.8)',
                      fontStyle: 'italic',
                    },
                  ]}
                >
                  Whatever you were doing - do it again.
                </Text>
                <View style={styles.wrappedWhiteRule} />
                <Text
                  style={[styles.wrappedBodyCenterSmall, { fontFamily: FONT_BODY, color: 'rgba(255,255,255,0.7)' }]}
                >
                  Unlock your Spicy Report next year 🌶️
                </Text>
                <Text
                  style={[styles.wrappedAbsFooter, footerUrlStyle, { color: 'rgba(255,255,255,0.4)' }]}
                >
                  oursparkapp.com
                </Text>
              </View>,
              true,
              2,
              true,
              true
            )}

            {cardShell(
              'w4',
              DARK_BG,
              <View style={styles.wrappedCardPad}>
                <Text
                  style={[
                    styles.wrappedLabelPurple,
                    { fontFamily: FONT_BODY, color: PURPLE, paddingTop: 100 },
                  ]}
                >
                  YOU ARE
                </Text>
                <Text style={[styles.wrappedCategoryTitle, { fontFamily: FONT_HEADING, color: ORANGE }]}>
                  {cat.title}
                </Text>
                <Text
                  style={[
                    styles.wrappedBodyCenter,
                    {
                      fontFamily: FONT_BODY,
                      color: TEXT_ON_DARK,
                      paddingHorizontal: 32,
                      paddingTop: 8,
                      lineHeight: 26,
                    },
                  ]}
                >
                  {cat.description}
                </Text>
                <Text style={[styles.wrappedAbsFooter, footerUrlStyle, { color: PURPLE }]}>
                  oursparkapp.com
                </Text>
              </View>,
              true,
              3,
              true,
              true
            )}

            {cardShell(
              'w5',
              '#FFFFFF',
              <View style={styles.wrappedCardPad}>
                <Ionicons name="eye-outline" size={60} color={PURPLE} style={styles.wrappedHumourIcon} />
                <Text style={[styles.wrappedHumourStat, { fontFamily: FONT_HEADING, color: BG }]}>
                  {d.humourStat}
                </Text>
                <Text style={[styles.wrappedHumourWitty, { fontFamily: FONT_BODY, color: PURPLE }]}>
                  {WRAPPED_HUMOUR_WITTY}
                </Text>
                <Text style={[styles.wrappedAbsFooter, footerUrlStyle, { color: PURPLE }]}>
                  oursparkapp.com
                </Text>
              </View>,
              true,
              4,
              true,
              false
            )}

            {cardShell(
              'w6',
              DARK_BG,
              <View style={styles.wrappedCardPad}>
                <Text
                  style={[
                    styles.wrappedLabelPurple,
                    {
                      fontFamily: FONT_BODY,
                      color: 'rgba(241,233,210,0.4)',
                      paddingTop: 100,
                    },
                  ]}
                >
                  Based on everything you shared...
                </Text>
                <Text style={[styles.wrappedWordIntro, { fontFamily: FONT_BODY, color: 'rgba(241,233,210,0.6)' }]}>
                  Every question. Every answer. Every feeling you shared. It all pointed to one word.
                </Text>
                <Text
                  style={[
                    styles.wrappedWordBig,
                    { fontFamily: FONT_HEADING, color: ORANGE, letterSpacing: -2 },
                  ]}
                >
                  {d.relationshipWord}
                </Text>
                <View style={[styles.wrappedDividerOrange, { backgroundColor: ORANGE, width: 24 }]} />
                <Text style={[styles.wrappedWordOutro, { fontFamily: FONT_BODY, color: 'rgba(241,233,210,0.6)' }]}>
                  You kept showing up. That&apos;s the whole love story.
                </Text>
                <Image source={HOME_LOGO} style={styles.wrappedEndLogo} resizeMode="contain" />
                <Text style={[styles.wrappedEndUrl, { fontFamily: FONT_BODY, color: 'rgba(241,233,210,0.4)' }]}>
                  oursparkapp.com
                </Text>
              </View>,
              true,
              5,
              true,
              true
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function DashboardScreen({
  userId,
  onOpenSubscriptionPlans,
  onNavigateToPartnerSetup,
}: {
  userId: string;
  onOpenSubscriptionPlans: (coupleId: string, userId: string) => void;
  onNavigateToPartnerSetup: () => void;
}) {
  console.log('[DashboardScreen] component rendering, userId:', userId);
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  const [firstName, setFirstName] = useState('');
  const [partnerProfileRow, setPartnerProfileRow] = useState<Record<string, unknown> | null>(null);
  const [dateLine, setDateLine] = useState('');
  const [currentStreak, setCurrentStreak] = useState(0);
  const [compatibilityScore, setCompatibilityScore] = useState(0);
  const [vaultCount, setVaultCount] = useState(0);
  const [todayStatus, setTodayStatus] = useState<DailyQuestionStatus | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [showAddPartnerLink, setShowAddPartnerLink] = useState(true);
  const [reflection, setReflection] = React.useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [showWrapped, setShowWrapped] = useState(false);
  const [showWrappedTeaser, setShowWrappedTeaser] = useState(false);
  const [wrappedData, setWrappedData] = useState<WrappedData | null>(null);
  const [wrappedLoading, setWrappedLoading] = useState(false);
  const [activePackLine, setActivePackLine] = useState<string | null>(null);
  const didRegisterPushNotifications = useRef(false);

  const openWrapped = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? userId;
    const { data: profile } = await supabase
      .from('profiles')
      .select('couple_id')
      .eq('id', uid)
      .maybeSingle();
    const cid = profile?.couple_id != null ? String(profile.couple_id) : null;
    const pro = cid ? await checkIsPro(cid) : false;
    if (!pro) {
      setShowWrappedTeaser(true);
      return;
    }

    setShowWrapped(true);
    setWrappedLoading(true);
    const year = new Date().getFullYear();
    try {
      if (!cid) {
        setWrappedData(emptyWrappedData(year));
        return;
      }
      const fetched = await fetchWrappedData(cid, uid, year);
      setWrappedData(fetched);
    } finally {
      setWrappedLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    console.log('Dashboard mounted');
    const getReflection = async () => {
      console.log('Getting reflection...');
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        console.log('No user');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('couple_id')
        .eq('id', user.id)
        .maybeSingle();
      console.log('Profile for reflection:', JSON.stringify(profile));
      if (!profile) {
        return;
      }
      if (!profile.couple_id) {
        console.log('No couple_id');
        return;
      }

      const { data, error } = await supabase
        .from('reflections')
        .select('reflection_text')
        .eq('couple_id', profile.couple_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log('Reflection result:', JSON.stringify(data));
      console.log('Reflection error:', JSON.stringify(error));

      if (data?.reflection_text) {
        setReflection(data.reflection_text);
        console.log('Reflection set!');
      }
    };
    void getReflection();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseOpacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseOpacity]);

  const fetchDashboardData = useCallback(async () => {
    try {
    console.log('[fetchDashboard] function started, userId:', userId);
    const uid = userId;
    const now = new Date();

    setDateLine(formatTodayLong(now));

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('couple_id, name')
      .eq('id', uid)
      .maybeSingle();
    console.log('[fetchDashboard] profile query result:', JSON.stringify(profile), 'error:', JSON.stringify(profileError));
    console.log('[fetchDashboard] profile done:', profile?.couple_id ?? 'no couple');

    const profileRecord = profile as Record<string, unknown> | null | undefined;
    const greetingToken = userGreetingFirstName(profileRecord, undefined);
    setFirstName(greetingToken || USER_GREETING_FALLBACK);

    const nextCoupleId = profile?.couple_id ? String(profile.couple_id) : null;
    setCoupleId(nextCoupleId);
    console.log('[fetchDashboard] coupleId set:', nextCoupleId);
    setPartnerProfileRow(null);

    if (!nextCoupleId) {
      setShowAddPartnerLink(true);
      setCurrentStreak(0);
      setCompatibilityScore(0);
      setVaultCount(0);
      setReflection(null);
      setIsPro(false);
      setActivePackLine(null);
      return;
    }

    const { count: coupleProfileCount, error: coupleProfileCountError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('couple_id', nextCoupleId);
    setShowAddPartnerLink(
      coupleProfileCountError ? true : Math.max(0, coupleProfileCount ?? 0) < 2
    );

    const { data: partnerProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('couple_id', nextCoupleId)
      .neq('id', uid)
      .limit(1)
      .maybeSingle();
    setPartnerProfileRow((partnerProfile as Record<string, unknown> | null) ?? null);

    setIsPro(await checkIsPro(nextCoupleId));

    const { data: couple } = await supabase
      .from('couples')
      .select('current_streak, longest_streak, compatibility_score, last_answered_date, total_questions_answered')
      .eq('id', nextCoupleId)
      .maybeSingle();

    const streakVal = Math.max(0, Math.round(Number(couple?.current_streak ?? 0)));
    console.log('[streak] setting currentStreak to:', streakVal);
    setCurrentStreak(streakVal);

    setCompatibilityScore(Number(couple?.compatibility_score ?? 0));

    const { count: vaultCountResult, error: vaultError } = await supabase
      .from('vault')
      .select('*', { count: 'exact', head: true })
      .eq('couple_id', nextCoupleId);

    if (!vaultError) {
      setVaultCount(vaultCountResult ?? 0);
    } else {
      setVaultCount(0);
    }

    const { data: activePackRow } = await supabase
      .from('couple_packs')
      .select('current_day, packs(name, emoji)')
      .eq('couple_id', nextCoupleId)
      .eq('status', 'active')
      .maybeSingle();
    const packsMetaRaw = (activePackRow as Record<string, unknown> | null)?.packs;
    const packsMeta =
      Array.isArray(packsMetaRaw) && packsMetaRaw.length > 0
        ? (packsMetaRaw[0] as Record<string, unknown>)
        : (packsMetaRaw as Record<string, unknown> | null);
    if (packsMeta) {
      const emoji = typeof packsMeta.emoji === 'string' ? packsMeta.emoji : '✨';
      const name = typeof packsMeta.name === 'string' ? packsMeta.name : 'Pack';
      const day = Math.max(1, Number((activePackRow as Record<string, unknown>).current_day ?? 1));
      setActivePackLine(`${emoji} ${name} - Day ${day} active`);
    } else {
      setActivePackLine(null);
    }

    // Sundays only: generate via Edge Function if needed (DB row loaded below).
    if (new Date().getDay() === 0) {
      const invokeUrl = getGenerateReflectionInvokeUrl();
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (invokeUrl && anonKey) {
        try {
          const res = await fetch(invokeUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${anonKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ couple_id: nextCoupleId }),
          });
          const json = (await res.json()) as { reflection?: string };
          if (res.ok && typeof json.reflection === 'string' && json.reflection.trim()) {
            setReflection(json.reflection.trim());
          }
        } catch {
          // Edge function unavailable - reflection may still load from DB below
        }
      }
    }

    const coupleId = nextCoupleId;

    // Fetch weekly reflection
    try {
      console.log('Fetching reflection inside main fetch, couple_id:', coupleId);
      const { data: reflectionData } = await supabase
        .from('reflections')
        .select('reflection_text')
        .eq('couple_id', coupleId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (reflectionData?.reflection_text) {
        setReflection(reflectionData.reflection_text);
      }
    } catch {
      // ignore reflection fetch failures
    }

    console.log('[dashboardStatus] starting check, coupleId:', nextCoupleId, 'uid:', uid);
    const { questionId: qId } = await resolveTodaysQuestionForCoupleAnswers(nextCoupleId, uid, { now });
    console.log('[dashboardStatus] questionId:', qId);
    console.log('[dashboardStatus] coupleId:', nextCoupleId);
    if (!qId) {
      console.log('[dashboardStatus] setting state:', 'not_answered');
      setTodayStatus('not_answered');
    } else {
      const { data: answerRows } = await supabase
        .from('answers')
        .select('user_id')
        .eq('couple_id', nextCoupleId)
        .eq('question_id', qId);
      console.log('[dashboardStatus] answers query raw:', JSON.stringify(answerRows));
      const rows = (answerRows ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        console.log('[dashboardStatus] setting state:', 'not_answered');
        setTodayStatus('not_answered');
      } else if (rows.length >= 2) {
        console.log('[dashboardStatus] setting state:', 'reveal_ready');
        setTodayStatus('reveal_ready');
      } else {
        const only = rows[0];
        const belongsToMe = String(only?.user_id ?? '') === uid;
        const nextState: DailyQuestionStatus = belongsToMe ? 'waiting' : 'not_answered';
        console.log('[dashboardStatus] setting state:', nextState);
        setTodayStatus(nextState);
      }
    }
  } catch (error) {
    console.log('[dashboardData] error caught:', error);
  }
  }, [userId]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(DASHBOARD_COUPLE_STATS_REFRESH, () => {
      void fetchDashboardData();
    });
    return () => sub.remove();
  }, [fetchDashboardData]);

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [fetchDashboardData])
  );

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const cached = await AsyncStorage.getItem('cached_today_status');
          if (cached === 'not_answered' || cached === 'waiting' || cached === 'reveal_ready') {
            setTodayStatus(cached);
          }

          const { data: authData } = await supabase.auth.getUser();
          const uid = authData.user?.id ?? userId;
          console.log('[statusCheck] start', { uid });

          const { data: profile } = await supabase
            .from('profiles')
            .select('couple_id')
            .eq('id', uid)
            .maybeSingle();
          const coupleId = profile?.couple_id != null ? String(profile.couple_id) : null;

          if (!coupleId) {
            setTodayStatus(null);
            console.log('[statusCheck] result:', null);
            return;
          }

          const { data: partnerProfile } = await supabase
            .from('profiles')
            .select('name')
            .eq('couple_id', coupleId)
            .neq('id', uid)
            .limit(1)
            .maybeSingle();
          setPartnerProfileRow((partnerProfile as Record<string, unknown> | null) ?? null);

          const { questionId: qId } = await resolveTodaysQuestionForCoupleAnswers(coupleId, uid, {
            now: new Date(),
          });

          if (!qId) {
            setTodayStatus(null);
            console.log('[statusCheck] result:', null);
            return;
          }

          const { data: answerRows } = await supabase
            .from('answers')
            .select('user_id')
            .eq('couple_id', coupleId)
            .eq('question_id', qId);

          const rows = (answerRows ?? []) as Record<string, unknown>[];
          let status: DailyQuestionStatus = 'not_answered';
          if (rows.length === 0) {
            status = 'not_answered';
          } else if (rows.length >= 2) {
            status = 'reveal_ready';
          } else {
            const belongsToMe = String(rows[0]?.user_id ?? '') === uid;
            status = belongsToMe ? 'waiting' : 'not_answered';
          }

          setTodayStatus(status);
          await AsyncStorage.setItem('cached_today_status', status);
          console.log('[statusCheck] result:', status);
        } catch {
          // ignore status check failures
        }
      })();
    }, [userId])
  );

  useFocusEffect(
    useCallback(() => {
      if (didRegisterPushNotifications.current) {
        return;
      }
      didRegisterPushNotifications.current = true;
      void (async () => {
        await registerForPushNotifications();
        await scheduleQuestionNotification();
      })();
    }, [])
  );

  const goToToday = () => {
    navigation.navigate('Question');
  };

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete your account?',
      'This will permanently delete your account and all your OurSpark moments. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const { data: profileRow, error: profileReadError } = await supabase
                  .from('profiles')
                  .select('couple_id')
                  .eq('id', userId)
                  .maybeSingle();
                if (profileReadError) {
                  throw profileReadError;
                }
                const userCoupleId =
                  profileRow?.couple_id != null ? String(profileRow.couple_id) : null;

                const { error: answersUserError } = await supabase.from('answers').delete().eq('user_id', userId);
                if (answersUserError) {
                  throw answersUserError;
                }

                if (userCoupleId) {
                  const { error: vaultError } = await supabase.from('vault').delete().eq('couple_id', userCoupleId);
                  if (vaultError) {
                    throw vaultError;
                  }

                  const { error: coupleBadgesError } = await supabase
                    .from('couple_badges')
                    .delete()
                    .eq('couple_id', userCoupleId);
                  if (coupleBadgesError) {
                    throw coupleBadgesError;
                  }

                  const { error: couplePacksError } = await supabase
                    .from('couple_packs')
                    .delete()
                    .eq('couple_id', userCoupleId);
                  if (couplePacksError) {
                    throw couplePacksError;
                  }

                  const { error: spicyPicksError } = await supabase
                    .from('spicy_level_picks')
                    .delete()
                    .eq('user_id', userId);
                  if (spicyPicksError) {
                    throw spicyPicksError;
                  }

                  const { error: spicyUsedError } = await supabase
                    .from('spicy_questions_used')
                    .delete()
                    .eq('couple_id', userCoupleId);
                  if (spicyUsedError) {
                    throw spicyUsedError;
                  }

                  const { error: wrappedError } = await supabase.from('wrapped').delete().eq('couple_id', userCoupleId);
                  if (wrappedError) {
                    throw wrappedError;
                  }

                  const { error: answersCoupleError } = await supabase
                    .from('answers')
                    .delete()
                    .eq('couple_id', userCoupleId);
                  if (answersCoupleError) {
                    throw answersCoupleError;
                  }

                  const { error: clearCoupleOnProfilesError } = await supabase
                    .from('profiles')
                    .update({ couple_id: null })
                    .eq('couple_id', userCoupleId);
                  if (clearCoupleOnProfilesError) {
                    throw clearCoupleOnProfilesError;
                  }

                  const { error: couplesError } = await supabase.from('couples').delete().eq('id', userCoupleId);
                  if (couplesError) {
                    throw couplesError;
                  }
                } else {
                  const { error: spicyPicksSoloError } = await supabase
                    .from('spicy_level_picks')
                    .delete()
                    .eq('user_id', userId);
                  if (spicyPicksSoloError) {
                    throw spicyPicksSoloError;
                  }
                }

                const { error: profileError } = await supabase.from('profiles').delete().eq('id', userId);
                if (profileError) {
                  throw profileError;
                }

                const { error: signOutError } = await supabase.auth.signOut();
                if (signOutError) {
                  throw signOutError;
                }
                await AsyncStorage.removeItem('cached_today_status');
              } catch {
                Alert.alert('Something went wrong. Please contact support@oursparkapp.com');
              }
            })();
          },
        },
      ]
    );
  }, [userId]);

  const greeting = `${getGreetingPrefix(new Date())}, ${firstName || USER_GREETING_FALLBACK}`;
  const dashboardPartnerWaitingPhrase = useMemo(
    () => partnerPossessivePhraseName(partnerProfileRow),
    [partnerProfileRow]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.dashboardScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.dbGreeting}>{greeting}</Text>
        <Text style={styles.dbDateLine}>{dateLine}</Text>

        {todayStatus !== null ? (
          <View
            style={[
              styles.dbTodayCard,
              todayStatus === 'reveal_ready' ? styles.dbTodayCardGlow : null,
            ]}
          >
            <Text style={styles.dbStatusSmall}>{"TODAY'S QUESTION"}</Text>
            {todayStatus === 'not_answered' ? (
              <>
                <View style={styles.dbTitleIconRow}>
                  <Ionicons name="chatbubble-outline" size={20} color={TEXT} />
                  <Text style={styles.dbTodayTitle}>Your question is waiting</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.92}
                  style={styles.dbAnswerNowBtn}
                  onPress={goToToday}
                >
                  <Text style={styles.dbAnswerNowText}>Answer Now</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {todayStatus === 'waiting' ? (
              <>
                <Text style={styles.dbWaitingSub}>
                  Waiting for {dashboardPartnerWaitingPhrase}&apos;s answer...
                </Text>
                <View style={styles.dbPulseRow}>
                  <Animated.View style={[styles.dbPulseDot, { opacity: pulseOpacity }]} />
                </View>
              </>
            ) : null}
            {todayStatus === 'reveal_ready' ? (
              <View style={styles.dbRevealReadyWrap}>
                <View style={styles.dbTitleIconRow}>
                  <Ionicons name="sparkles-outline" size={24} color={ORANGE} />
                  <Text style={styles.dbTodayTitleReveal}>Your reveal is ready!</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.92}
                  style={styles.dbSeeRevealBtn}
                  onPress={goToToday}
                >
                  <Text style={styles.dbSeeRevealText}>See The Reveal</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {activePackLine ? <Text style={styles.dbActivePackLine}>{activePackLine}</Text> : null}
          </View>
        ) : null}

        <View style={styles.dbStreakRow}>
          <View style={styles.dbHalfCard}>
            <Text style={styles.dbStatEmoji}>🔥</Text>
            {currentStreak > 0 ? (
              <>
                <Text style={styles.dbStatNumberStreak}>{currentStreak}</Text>
                <Text style={styles.dbStatCaption}>days in sync</Text>
              </>
            ) : (
              <Text style={styles.dbStatEmptyText}>Answer today to start your spark!</Text>
            )}
          </View>
          <View style={styles.dbHalfCard}>
            <Ionicons name="sparkles-outline" size={24} color={ORANGE} style={styles.dbStatIconTop} />
            {compatibilityScore > 0 ? (
              <>
                <Text style={styles.dbStatNumberCompat}>{compatibilityScore}%</Text>
                <Text style={styles.dbStatCaption}>in sync</Text>
              </>
            ) : (
              <Text style={styles.dbStatEmptyText}>Your spark score awaits</Text>
            )}
          </View>
        </View>

        {reflection !== null ? (
          <View style={styles.dbReflectionCard}>
            <View style={styles.dbReflectionLabelRow}>
              <Ionicons name="sparkles-outline" size={16} color={PURPLE} />
              <Text style={styles.dbReflectionLabel}>{"THIS WEEK'S REFLECTION"}</Text>
            </View>
            {(() => {
              if (isPro) {
                return (
                  <>
                    <Text style={styles.dbReflectionBody}>{reflection}</Text>
                    <Text style={styles.dbReflectionFooter}>Generated by OurSpark AI</Text>
                  </>
                );
              }
              const { preview, isTruncated } = formatReflectionFreeTier(reflection);
              return (
                <>
                  <Text style={styles.dbReflectionBody}>{preview}</Text>
                  {isTruncated ? (
                    <>
                      <Text style={styles.dbReflectionEllipsis}>...</Text>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => {
                          if (coupleId) {
                            onOpenSubscriptionPlans(coupleId, userId);
                          }
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      >
                        <Text style={styles.dbReflectionReadFull}>Read your full reflection →</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  <Text style={styles.dbReflectionFooter}>Generated by OurSpark AI</Text>
                </>
              );
            })()}
          </View>
        ) : null}

        <TouchableOpacity activeOpacity={0.9} style={styles.dbVaultCard} onPress={() => navigation.navigate('Vault')}>
          <View style={styles.dbVaultTitleRow}>
            <Ionicons name="heart-outline" size={22} color={TEXT} />
            <Text style={styles.dbVaultTitle}>Your Spark Vault</Text>
          </View>
          {vaultCount > 0 ? (
            <Text style={styles.dbVaultSub}>
              {vaultCount} Perfect Sync moment{vaultCount === 1 ? '' : 's'} saved
            </Text>
          ) : (
            <Text style={styles.dbVaultSub}>Your first Perfect Sync moment will live here</Text>
          )}
        </TouchableOpacity>

        {isValentinesDayLocal() ? (
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.dbWrappedTeaser}
            onPress={() => void openWrapped()}
          >
            <Text style={styles.dbWrappedTeaserTitle}>
              Your {new Date().getFullYear()} Spark Story is here
            </Text>
            <Text style={styles.dbWrappedTeaserSub}>Tap to open Wrapped</Text>
          </TouchableOpacity>
        ) : null}

        {showAddPartnerLink ? (
          <TouchableOpacity activeOpacity={0.85} style={styles.dbAddPartnerLinkWrap} onPress={onNavigateToPartnerSetup}>
            <Text style={styles.dbAddPartnerLinkText}>Add your partner</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.dbAccountLinksRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.dbSignOutLinkWrap}
            onPress={() => {
              void (async () => {
                await AsyncStorage.removeItem('cached_today_status');
                await supabase.auth.signOut();
              })();
            }}
          >
            <Text style={styles.dbSignOutLinkText}>Sign out</Text>
          </TouchableOpacity>
          <Text style={styles.dbAccountLinkSeparator}> | </Text>
          <TouchableOpacity activeOpacity={0.8} style={styles.dbDeleteAccountLinkWrap} onPress={handleDeleteAccount}>
            <Text style={styles.dbDeleteAccountLinkText}>Delete account</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {showWrapped ? (
        <OurSparkWrappedModal
          visible
          onClose={() => setShowWrapped(false)}
          data={wrappedData}
          loading={wrappedLoading}
        />
      ) : null}

      {showWrappedTeaser ? (
        <WrappedTeaserModal
          visible
          onClose={() => setShowWrappedTeaser(false)}
          onUnlock={() => {
            if (coupleId) {
              onOpenSubscriptionPlans(coupleId, userId);
            }
          }}
        />
      ) : null}

    </SafeAreaView>
  );
}

type DailyState = 'answer' | 'waiting' | 'reveal';
type SpicyLevel = 'mild' | 'medium' | 'hot';
type SpicyStage = 0 | 1 | 2 | 3 | 4;

type ActivePackForToday = {
  id: string;
  packId: string;
  currentDay: number;
  durationDays: number;
  name: string;
  emoji: string;
  color: string;
};

function DailyQuestionScreen({ userId }: { userId: string }) {
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;
  const [answer, setAnswer] = useState('');
  const todayLabel = useMemo(() => formatTodayLong(new Date()), []);
  const [dailyQuestion, setDailyQuestion] = useState('');
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [dailyState, setDailyState] = useState<DailyState>('answer');
  const [myAnswer, setMyAnswer] = useState('');
  const [partnerAnswer, setPartnerAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vaultSaveBanner, setVaultSaveBanner] = useState(false);
  const vaultSaveBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dailyLoadReady, setDailyLoadReady] = useState(false);
  const [partnerName, setPartnerName] = useState<string>(PARTNER_HEADING_FALLBACK);
  const partnerNameRef = useRef(partnerName);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showPerfectSyncModal, setShowPerfectSyncModal] = useState(false);
  const [milestoneData, setMilestoneData] = useState<MilestoneData | null>(null);
  const pendingMilestoneRef = useRef<MilestoneData | null>(null);
  const perfectSyncModalShownKeyRef = useRef<string | null>(null);
  const perfectSyncOpacity = useRef(new Animated.Value(0)).current;
  const milestoneModalOpacity = useRef(new Animated.Value(0)).current;
  const perfectSyncCardRef = useRef<ViewShot | null>(null);
  const milestoneCardRef = useRef<ViewShot | null>(null);
  const [badgeToast, setBadgeToast] = useState<string | null>(null);
  const badgeToastQueueRef = useRef<string[]>([]);
  const badgeToastTranslateY = useRef(new Animated.Value(120)).current;
  const badgeToastDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activePack, setActivePack] = useState<ActivePackForToday | null>(null);
  const [showPackCompleteModal, setShowPackCompleteModal] = useState(false);
  const [completedPack, setCompletedPack] = useState<ActivePackForToday | null>(null);
  const [spicyStage, setSpicyStage] = useState<SpicyStage | null>(null);
  const [spicyMyLevel, setSpicyMyLevel] = useState<SpicyLevel | null>(null);
  const [spicyPartnerLevel, setSpicyPartnerLevel] = useState<SpicyLevel | null>(null);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseOpacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseOpacity]);

  const isSpicyPackActive = Boolean(activePack && activePack.name === 'Spicy Pack');

  const spicyLevelMeta = (level: SpicyLevel): { emoji: string; label: string } => {
    if (level === 'mild') {
      return { emoji: '🌶️', label: 'Mild' };
    }
    if (level === 'medium') {
      return { emoji: '🌶️🌶️', label: 'Medium' };
    }
    return { emoji: '🌶️🌶️🌶️', label: 'Hot' };
  };

  const spicyServingLevel = (a: SpicyLevel, b: SpicyLevel): SpicyLevel => {
    const rank: Record<SpicyLevel, number> = { mild: 0, medium: 1, hot: 2 };
    return rank[a] <= rank[b] ? a : b;
  };

  const spicyMismatchCopy = (mine: SpicyLevel, theirs: SpicyLevel, partner: string): string => {
    const key = `${mine}:${theirs}`;
    if (key === 'hot:mild' || key === 'mild:hot') {
      return `You're feeling Hot today. ${partner} is feeling Mild - and that's okay. Here's something for where you both are.`;
    }
    if (key === 'medium:mild' || key === 'mild:medium') {
      return "Different temperatures today. That happens. Here's a question that works for both of you.";
    }
    return `You're running a little hotter today. ${partner} is feeling Medium - so here's something that works beautifully for both of you.`;
  };

  useEffect(() => {
    partnerNameRef.current = partnerName;
  }, [partnerName]);

  const enqueueBadgeToast = useCallback((name: string) => {
    setBadgeToast((current) => {
      if (current) {
        badgeToastQueueRef.current.push(name);
        return current;
      }
      return name;
    });
  }, []);

  useEffect(() => {
    if (!badgeToast) {
      const next = badgeToastQueueRef.current.shift();
      if (next) {
        setBadgeToast(next);
      }
      return;
    }
    if (badgeToastDismissTimerRef.current) {
      clearTimeout(badgeToastDismissTimerRef.current);
    }
    badgeToastTranslateY.setValue(120);
    Animated.timing(badgeToastTranslateY, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
    badgeToastDismissTimerRef.current = setTimeout(() => {
      Animated.timing(badgeToastTranslateY, {
        toValue: 120,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setBadgeToast(null);
      });
    }, 3000);
    return () => {
      if (badgeToastDismissTimerRef.current) {
        clearTimeout(badgeToastDismissTimerRef.current);
        badgeToastDismissTimerRef.current = null;
      }
    };
  }, [badgeToast]);

  const answerMatchMeta = useMemo(
    () => getAnswerMatchMeta(myAnswer, partnerAnswer),
    [myAnswer, partnerAnswer]
  );

  const readAnswerText = (answerRow: Record<string, unknown>): string => {
    const candidates = [
      answerRow.answer_text,
      answerRow.answer,
      answerRow.response_text,
      answerRow.text,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  };

  const updateCoupleStatsAfterReveal = async (
    myText: string,
    theirText: string,
    statsCoupleId?: string | null,
    statsQuestionId?: string | null
  ) => {
    const coupleIdForStats = statsCoupleId ?? coupleId;
    if (!coupleIdForStats) {
      return;
    }
    const questionIdForStats = statsQuestionId ?? questionId;

    const { data: couple, error } = await supabase
      .from('couples')
      .select(
        'current_streak,longest_streak,last_answered_date,total_questions_answered,total_matches,compatibility_score'
      )
      .eq('id', coupleIdForStats)
      .maybeSingle();

    if (error || !couple) {
      return;
    }

    const todayKey = formatLocalDateKey(new Date());
    const lastAnsweredKey = coupleDateKeyFromDbValue(couple.last_answered_date);
    if (lastAnsweredKey === todayKey) {
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = formatLocalDateKey(yesterday);

    const priorStreak = Number(couple.current_streak ?? 0);
    const nextStreak = lastAnsweredKey === yesterdayKey ? priorStreak + 1 : 1;
    const nextLongestStreak = Math.max(Number(couple.longest_streak ?? 0), nextStreak);
    const nextTotalAnswered = Number(couple.total_questions_answered ?? 0) + 1;

    const normalizedMine = myText.trim().toLowerCase();
    const normalizedTheirs = theirText.trim().toLowerCase();
    const isMatch = Boolean(normalizedMine) && normalizedMine === normalizedTheirs;
    const nextTotalMatches = Number(couple.total_matches ?? 0) + (isMatch ? 1 : 0);
    const nextCompatibility = Math.round((nextTotalMatches / nextTotalAnswered) * 100);

    const { error: updateError } = await supabase
      .from('couples')
      .update({
        current_streak: nextStreak,
        longest_streak: nextLongestStreak,
        last_answered_date: todayKey,
        total_questions_answered: nextTotalAnswered,
        total_matches: nextTotalMatches,
        compatibility_score: nextCompatibility,
      })
      .eq('id', coupleIdForStats);

    if (updateError) {
      return;
    }

    DeviceEventEmitter.emit(DASHBOARD_COUPLE_STATS_REFRESH);

    if (questionIdForStats) {
      void checkAndAwardBadges({
        coupleId: coupleIdForStats,
        userId,
        questionId: questionIdForStats,
        myText,
        theirText,
        isPerfectSync: getAnswerMatchMeta(myText, theirText).tier === 'perfect',
        streakAfterUpdate: nextStreak,
        onBadgeAwarded: enqueueBadgeToast,
      });
    }

    if (isWeeklyStreakMilestone(nextStreak)) {
      const data: MilestoneData = {
        streak: nextStreak,
        partnerName: partnerNameRef.current,
      };
      const matchMeta = getAnswerMatchMeta(myText, theirText);
      if (matchMeta.tier === 'perfect') {
        pendingMilestoneRef.current = data;
      } else {
        setMilestoneData(data);
        setShowMilestoneModal(true);
      }
    }
  };

  useEffect(() => {
    if (!dailyLoadReady || dailyState !== 'reveal' || answerMatchMeta.tier !== 'perfect' || !questionId) {
      return;
    }
    const key = `${questionId}-${formatLocalDateKey(new Date())}`;
    if (perfectSyncModalShownKeyRef.current === key) {
      return;
    }
    perfectSyncModalShownKeyRef.current = key;
    setShowPerfectSyncModal(true);
  }, [dailyLoadReady, dailyState, answerMatchMeta.tier, questionId]);

  useEffect(() => {
    if (!showPerfectSyncModal) {
      return;
    }
    perfectSyncOpacity.setValue(0);
    Animated.timing(perfectSyncOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [showPerfectSyncModal]);

  useEffect(() => {
    if (!showMilestoneModal) {
      return;
    }
    milestoneModalOpacity.setValue(0);
    Animated.timing(milestoneModalOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [showMilestoneModal]);

  const dismissPerfectSyncModal = () => {
    Animated.timing(perfectSyncOpacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      setShowPerfectSyncModal(false);
      if (pendingMilestoneRef.current) {
        setMilestoneData(pendingMilestoneRef.current);
        pendingMilestoneRef.current = null;
        setShowMilestoneModal(true);
      }
    });
  };

  const dismissMilestoneModal = () => {
    Animated.timing(milestoneModalOpacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      setShowMilestoneModal(false);
    });
  };

  const onSavePerfectSyncCard = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Please allow access to your camera roll in Settings.');
        return;
      }
      const shot = perfectSyncCardRef.current;
      if (!shot?.capture) {
        Alert.alert('Could not capture the card. Please try again.');
        return;
      }
      const uri = await shot.capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved to your camera roll! Share it on Instagram Stories.');
    } catch {
      Alert.alert('Could not save the image. Please try again.');
    }
  };

  const onSaveMilestoneCard = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Please allow access to your camera roll in Settings.');
        return;
      }
      const shot = milestoneCardRef.current;
      if (!shot?.capture) {
        Alert.alert('Could not capture the card. Please try again.');
        return;
      }
      const uri = await shot.capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved to your camera roll! Share it on Instagram Stories.');
    } catch {
      Alert.alert('Could not save the image. Please try again.');
    }
  };

  useEffect(() => {
    const loadQuestion = async () => {
      console.log('loadQuestion called with userId:', userId);
      setDailyLoadReady(false);
      setCoupleId(null);
      setQuestionId(null);
      setDailyQuestion('');
      setActivePack(null);
      setSpicyStage(null);
      setSpicyMyLevel(null);
      setSpicyPartnerLevel(null);

      const now = new Date();

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('couple_id, name')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        setDailyLoadReady(true);
        return;
      }

      console.log('Profile loaded:', JSON.stringify(profile));

      const cid = profile.couple_id != null ? String(profile.couple_id) : null;
      setCoupleId(cid);

      if (!cid) {
        setQuestionId(null);
        setDailyLoadReady(true);
        return;
      }

      const { data: activePackData } = await supabase
        .from('couple_packs')
        .select('*, packs(*)')
        .eq('couple_id', cid)
        .eq('status', 'active')
        .maybeSingle();
      console.log('Active pack:', JSON.stringify(activePackData));

      let selectedQuestion: Record<string, unknown> | null = null;
      let resolvedQuestionId: string | null = null;
      if (activePackData) {
        const ap = activePackData as Record<string, unknown>;
        const packId = ap.pack_id != null ? String(ap.pack_id) : '';
        const day = Math.max(1, Number(ap.current_day ?? 1));
        const packsRaw = ap.packs;
        const packMeta =
          Array.isArray(packsRaw) && packsRaw.length > 0
            ? (packsRaw[0] as Record<string, unknown>)
            : (packsRaw as Record<string, unknown> | null);

        if (packMeta) {
          const packName = typeof packMeta.name === 'string' ? packMeta.name : 'Pack';
          setActivePack({
            id: String(ap.id),
            packId,
            currentDay: day,
            durationDays: Math.max(1, Number(packMeta.duration_days ?? packMeta.duration ?? 1)),
            name: packName,
            emoji: typeof packMeta.emoji === 'string' ? packMeta.emoji : '✨',
            color: typeof packMeta.color === 'string' ? packMeta.color : PURPLE,
          });

          if (packName === 'Spicy Pack') {
            const todayKey = formatLocalDateKey(now);
            const { data: levelPicks } = await supabase
              .from('spicy_level_picks')
              .select('user_id, level')
              .eq('couple_id', cid)
              .eq('pick_date', todayKey);
            const rows = (levelPicks ?? []) as Record<string, unknown>[];
            const mine = rows.find((r) => String(r.user_id ?? '') === userId);
            const partner = rows.find((r) => String(r.user_id ?? '') !== userId);
            const myLevel =
              typeof mine?.level === 'string' ? (mine.level as SpicyLevel) : null;
            const partnerLevel =
              typeof partner?.level === 'string' ? (partner.level as SpicyLevel) : null;
            setSpicyMyLevel(myLevel);
            setSpicyPartnerLevel(partnerLevel);

            if (!myLevel) {
              setSpicyStage(0);
              setDailyLoadReady(true);
              return;
            }
            if (!partnerLevel) {
              setSpicyStage(1);
              setDailyLoadReady(true);
              return;
            }
            const spicyResolution = await resolveTodaysQuestionForCoupleAnswers(cid, userId, {
              activePackData: activePackData as Record<string, unknown>,
              now,
            });
            selectedQuestion = spicyResolution.selectedQuestion;
            resolvedQuestionId = spicyResolution.questionId;
            if (spicyResolution.questionText) {
              setDailyQuestion(spicyResolution.questionText);
            }
            if (!resolvedQuestionId) {
              setSpicyStage(2);
              setDailyLoadReady(true);
              return;
            }
            setSpicyStage(3);
          }
        } else {
          setActivePack(null);
        }

        const resolution = await resolveTodaysQuestionForCoupleAnswers(cid, userId, {
          activePackData: activePackData as Record<string, unknown>,
          now,
        });
        selectedQuestion = resolution.selectedQuestion;
        resolvedQuestionId = resolution.questionId;
        if (resolution.questionText) {
          setDailyQuestion(resolution.questionText);
        }
      } else {
        const resolution = await resolveTodaysQuestionForCoupleAnswers(cid, userId, {
          activePackData: null,
          now,
        });
        selectedQuestion = resolution.selectedQuestion;
        resolvedQuestionId = resolution.questionId;
        if (resolution.questionText) {
          setDailyQuestion(resolution.questionText);
        }
      }

      console.log('Question loaded:', JSON.stringify(selectedQuestion));

      if (!resolvedQuestionId) {
        setQuestionId(null);
        setDailyLoadReady(true);
        return;
      }

      const normalizedQuestionId = String(resolvedQuestionId);
      const normalizedCoupleId = cid;
      setQuestionId(normalizedQuestionId);

      const { data: myAnswerRows } = await supabase
        .from('answers')
        .select('*')
        .eq('user_id', userId)
        .eq('question_id', normalizedQuestionId)
        .limit(1);
      const mineRow = (myAnswerRows?.[0] ?? null) as Record<string, unknown> | null;

      if (!mineRow) {
        setMyAnswer('');
        setPartnerAnswer('');
        setDailyState('answer');
        setDailyLoadReady(true);
        return;
      }

      setMyAnswer(readAnswerText(mineRow));

      const { data: partnerAnswerRows } = await supabase
        .from('answers')
        .select('*')
        .eq('couple_id', normalizedCoupleId)
        .eq('question_id', normalizedQuestionId)
        .neq('user_id', userId)
        .limit(1);
      const partnerRow = (partnerAnswerRows?.[0] ?? null) as Record<string, unknown> | null;

      if (partnerRow) {
        setPartnerAnswer(readAnswerText(partnerRow));
        setDailyState('reveal');
        await updateCoupleStatsAfterReveal(
          readAnswerText(mineRow),
          readAnswerText(partnerRow),
          normalizedCoupleId,
          normalizedQuestionId
        );
      } else {
        setPartnerAnswer('');
        setDailyState('waiting');
      }

      setDailyLoadReady(true);
    };

    loadQuestion();
  }, [userId]);

  useEffect(() => {
    if (!coupleId || !userId) {
      console.log('[partnerName] skipping fetch until coupleId is loaded', { coupleId, userId });
      setPartnerName(PARTNER_HEADING_FALLBACK);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('name')
        .eq('couple_id', coupleId)
        .neq('id', userId)
        .maybeSingle();

      if (cancelled) {
        return;
      }
      const resolvedPartnerName =
        !error && typeof data?.name === 'string' && data.name.trim().length > 0
          ? data.name.trim()
          : 'your partner';
      setPartnerName(resolvedPartnerName);
      console.log('[partnerName] resolved partnerName', {
        partnerName: resolvedPartnerName,
        hasPartnerRow: Boolean(data),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [coupleId, userId]);

  const waitingPartnerName = useMemo(() => {
    const trimmed = partnerName.trim();
    if (!trimmed || trimmed.toLowerCase() === PARTNER_HEADING_FALLBACK.toLowerCase()) {
      return PARTNER_PHRASE_FALLBACK;
    }
    return trimmed;
  }, [partnerName]);

  const waitingMessage = useMemo(
    () => `Waiting for ${waitingPartnerName}'s answer...`,
    [waitingPartnerName]
  );

  const needsAccountSetup = useMemo(
    () => !dailyLoadReady || !coupleId || !questionId,
    [dailyLoadReady, coupleId, questionId]
  );

  const canSubmitAnswer = Boolean(dailyLoadReady && coupleId && questionId);

  useEffect(() => {
    if (dailyState !== 'waiting' || !coupleId || !questionId) {
      return;
    }

    const channelName = `today-answers-${coupleId}-${questionId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'answers',
          filter: `couple_id=eq.${coupleId}`,
        },
        async (payload) => {
          const newRow = payload.new as Record<string, unknown>;
          const sameQuestion = String(newRow.question_id ?? '') === questionId;

          if (!sameQuestion) {
            return;
          }

          const answerRows = await fetchTodayAnswersRows(coupleId, questionId);
          const mine = answerRows.find((row) => String(row.user_id ?? '') === userId);
          const partner = answerRows.find((row) => String(row.user_id ?? '') !== userId);

          if (mine) {
            setMyAnswer(readAnswerText(mine));
          }
          if (partner) {
            setPartnerAnswer(readAnswerText(partner));
          }

          if (mine && partner) {
            setDailyState('reveal');
            await updateCoupleStatsAfterReveal(readAnswerText(mine), readAnswerText(partner));
            void sendRevealNotification();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, dailyState, questionId, userId]);

  useEffect(() => {
    if (!isSpicyPackActive || spicyStage !== 1 || !coupleId) {
      return;
    }
    const todayKey = formatLocalDateKey(new Date());
    const pollPicks = async () => {
      const { data } = await supabase
        .from('spicy_level_picks')
        .select('user_id, level')
        .eq('couple_id', coupleId)
        .eq('pick_date', todayKey);
      const rows = (data ?? []) as Record<string, unknown>[];
      const mine = rows.find((r) => String(r.user_id ?? '') === userId);
      const partner = rows.find((r) => String(r.user_id ?? '') !== userId);
      const myLevel = typeof mine?.level === 'string' ? (mine.level as SpicyLevel) : null;
      const partnerLevel = typeof partner?.level === 'string' ? (partner.level as SpicyLevel) : null;
      if (myLevel) {
        setSpicyMyLevel(myLevel);
      }
      if (partnerLevel) {
        setSpicyPartnerLevel(partnerLevel);
        setSpicyStage(2);
      }
    };
    void pollPicks();
    const id = setInterval(() => {
      void pollPicks();
    }, 5000);
    return () => clearInterval(id);
  }, [coupleId, isSpicyPackActive, spicyStage, userId]);

  useEffect(() => {
    if (dailyState !== 'waiting' || !coupleId || !questionId) {
      return;
    }

    const poll = async () => {
      const answerRows = await fetchTodayAnswersRows(coupleId, questionId);
      const mine = answerRows.find((row) => String(row.user_id ?? '') === userId);
      const partner = answerRows.find((row) => String(row.user_id ?? '') !== userId);
      if (mine && partner) {
        setMyAnswer(readAnswerText(mine));
        setPartnerAnswer(readAnswerText(partner));
        setDailyState('reveal');
        await updateCoupleStatsAfterReveal(readAnswerText(mine), readAnswerText(partner));
        void sendRevealNotification();
      }
    };

    const id = setInterval(() => {
      void poll();
    }, 5000);

    return () => clearInterval(id);
  }, [coupleId, dailyState, questionId, userId]);

  const submitAnswer = async () => {
    const answerText = answer.trim();
    const currentQuestion = questionId ? { id: questionId } : null;

    console.log('Submit answer tapped');
    console.log('Answer text:', answerText);
    console.log('User ID:', userId);

    if (!coupleId || !questionId || !answerText) {
      return;
    }

    setIsSubmitting(true);
    // Persist submission time; add `submitted_at timestamptz` to `answers` if the insert fails.
    const payload = {
      couple_id: coupleId,
      question_id: questionId,
      user_id: userId,
      answer_text: answerText,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('answers')
      .upsert(payload, { onConflict: 'user_id,question_id' });
    console.log('Upsert result error:', JSON.stringify(error));
    setIsSubmitting(false);

    if (error) {
      return;
    }

    if (activePack) {
      const nextDay = activePack.currentDay + 1;
      await supabase
        .from('couple_packs')
        .update({ current_day: nextDay })
        .eq('id', activePack.id);
      if (nextDay > activePack.durationDays) {
        await supabase
          .from('couple_packs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', activePack.id);
        if (coupleId) {
          await supabase.from('couples').update({ active_pack_id: null }).eq('id', coupleId);
        }
        setCompletedPack(activePack);
        setShowPackCompleteModal(true);
        setActivePack(null);
      } else {
        setActivePack((prev) => (prev ? { ...prev, currentDay: nextDay } : prev));
      }
    }

    setMyAnswer(answerText);
    setDailyState('waiting');
  };

  const submitSpicyLevel = async (level: SpicyLevel) => {
    if (!coupleId) {
      return;
    }
    const todayKey = formatLocalDateKey(new Date());
    const insertPayload = {
      user_id: userId,
      couple_id: coupleId,
      pick_date: todayKey,
      level,
    };
    const { error } = await supabase.from('spicy_level_picks').insert(insertPayload);
    if (error) {
      await supabase
        .from('spicy_level_picks')
        .update({ level })
        .eq('user_id', userId)
        .eq('couple_id', coupleId)
        .eq('pick_date', todayKey);
    }
    setSpicyMyLevel(level);
    setSpicyStage(1);
  };

  const loadSpicyQuestionForToday = async () => {
    if (!coupleId || !activePack || !spicyMyLevel || !spicyPartnerLevel) {
      return;
    }
    const serving = spicyServingLevel(spicyMyLevel, spicyPartnerLevel);
    const { data: usedRows } = await supabase
      .from('spicy_questions_used')
      .select('spicy_question_id')
      .eq('couple_id', coupleId)
      .eq('run_number', 1);
    const usedIds = (usedRows ?? [])
      .map((r) => String((r as Record<string, unknown>).spicy_question_id ?? ''))
      .filter(Boolean);

    const pickOne = async (excludeIds: string[]) => {
      let query = supabase.from('spicy_questions').select('*').eq('level', serving);
      if (excludeIds.length > 0) {
        query = query.not('id', 'in', `(${excludeIds.join(',')})`);
      }
      const { data } = await query;
      const list = (data ?? []) as Record<string, unknown>[];
      if (list.length === 0) {
        return null;
      }
      const idx = Math.floor(Math.random() * list.length);
      return list[idx];
    };

    let picked = await pickOne(usedIds);
    if (!picked) {
      const { data: levelRows } = await supabase.from('spicy_questions').select('id').eq('level', serving);
      const levelIds = (levelRows ?? [])
        .map((r) => String((r as Record<string, unknown>).id ?? ''))
        .filter(Boolean);
      if (levelIds.length > 0) {
        await supabase
          .from('spicy_questions_used')
          .delete()
          .eq('couple_id', coupleId)
          .eq('run_number', 1)
          .in('spicy_question_id', levelIds);
      }
      picked = await pickOne([]);
    }
    if (!picked) {
      return;
    }

    const qText =
      (typeof picked.question_text === 'string' && picked.question_text.trim()) ||
      (typeof picked.question === 'string' && picked.question.trim()) ||
      (typeof picked.prompt === 'string' && picked.prompt.trim()) ||
      '';
    if (!qText) {
      return;
    }

    await supabase.from('spicy_questions_used').insert({
      couple_id: coupleId,
      spicy_question_id: String(picked.id),
      run_number: 1,
      level: serving,
      created_at: new Date().toISOString(),
    });

    setDailyQuestion(qText);
    setQuestionId(String(picked.id));
    setDailyState('answer');
    setSpicyStage(3);
    setMyAnswer('');
    setPartnerAnswer('');
  };

  useEffect(() => {
    if (!isSpicyPackActive || spicyStage !== 3 || dailyState !== 'reveal') {
      return;
    }
    setSpicyStage(4);
  }, [dailyState, isSpicyPackActive, spicyStage]);

  const saveToVault = async () => {
    if (!coupleId || !questionId) {
      return;
    }
    const { error } = await supabase.from('vault').insert({
      couple_id: coupleId,
      question_id: questionId,
      saved_at: new Date().toISOString(),
    });
    if (!error) {
      const { data: firstSparkBadge } = await supabase
        .from('badges')
        .select('id')
        .eq('name', 'First Spark')
        .maybeSingle();

      if (firstSparkBadge?.id) {
        const { data: existingFirstSpark } = await supabase
          .from('couple_badges')
          .select('id')
          .eq('couple_id', coupleId)
          .eq('badge_id', firstSparkBadge.id)
          .maybeSingle();

        if (!existingFirstSpark) {
          await supabase.from('couple_badges').insert({
            couple_id: coupleId,
            badge_id: firstSparkBadge.id,
            earned_at: new Date().toISOString(),
          });
        }
      }

      void awardVaultKeeperIfFirstSave(coupleId, enqueueBadgeToast);
      if (vaultSaveBannerTimeoutRef.current) {
        clearTimeout(vaultSaveBannerTimeoutRef.current);
      }
      setVaultSaveBanner(true);
      vaultSaveBannerTimeoutRef.current = setTimeout(() => {
        vaultSaveBannerTimeoutRef.current = null;
        setVaultSaveBanner(false);
      }, 2000);
    }
  };

  useEffect(() => {
    return () => {
      if (vaultSaveBannerTimeoutRef.current) {
        clearTimeout(vaultSaveBannerTimeoutRef.current);
      }
    };
  }, []);

  const isDailyRevealScreen =
    !isSpicyPackActive && dailyLoadReady && canSubmitAnswer && dailyState === 'reveal';

  return (
    <SafeAreaView
      style={[
        styles.screen,
        isSpicyPackActive ? { backgroundColor: '#7B1A1A' } : null,
        isDailyRevealScreen ? styles.dailyRevealScreen : null,
      ]}
      edges={['top']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.dailyScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {activePack ? (
            <View style={[styles.todayPackPill, { backgroundColor: activePack.color }]}>
              <Text style={styles.todayPackPillText}>
                {activePack.emoji} {activePack.name} - Day {activePack.currentDay}
              </Text>
            </View>
          ) : null}
          {isSpicyPackActive && spicyStage === 0 ? (
            <View style={styles.spicyPickerWrap}>
              <Text style={styles.spicyDayLabel}>SPICY PACK - DAY {activePack?.currentDay ?? 1}</Text>
              <Text style={styles.spicyTitle}>How are you feeling today?</Text>
              <Text style={styles.spicySub}>
                Pick your level. Your partner picks theirs. Neither of you sees the other's choice until you both pick.
              </Text>

              <TouchableOpacity activeOpacity={0.9} style={styles.spicyLevelBtn} onPress={() => void submitSpicyLevel('mild')}>
                <Text style={styles.spicyLevelEmoji}>🌶️</Text>
                <View style={styles.spicyLevelTextCol}>
                  <Text style={styles.spicyLevelTitle}>Mild</Text>
                  <Text style={styles.spicyLevelDesc}>Flirty and playful</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.9} style={styles.spicyLevelBtn} onPress={() => void submitSpicyLevel('medium')}>
                <Text style={styles.spicyLevelEmoji}>🌶️🌶️</Text>
                <View style={styles.spicyLevelTextCol}>
                  <Text style={styles.spicyLevelTitle}>Medium</Text>
                  <Text style={styles.spicyLevelDesc}>Romantic and intentional</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.9} style={styles.spicyLevelBtn} onPress={() => void submitSpicyLevel('hot')}>
                <Text style={styles.spicyLevelEmojiHot}>🌶️🌶️🌶️</Text>
                <View style={styles.spicyLevelTextCol}>
                  <Text style={styles.spicyLevelTitle}>Hot</Text>
                  <Text style={styles.spicyLevelDesc}>Bold and direct</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : null}

          {isSpicyPackActive && spicyStage === 1 ? (
            <View style={styles.spicyWaitWrap}>
              <Text style={styles.spicyWaitTitle}>Waiting for {waitingPartnerName} to pick their level...</Text>
              <View style={styles.spicyWaitDotWrap}>
                <Animated.View style={[styles.spicyWaitDot, { opacity: pulseOpacity }]} />
              </View>
            </View>
          ) : null}

          {isSpicyPackActive && spicyStage === 2 && spicyMyLevel && spicyPartnerLevel ? (
            <View style={styles.spicyRevealWrap}>
              <View style={styles.spicyRevealRow}>
                <View style={styles.spicyRevealCard}>
                  <Text style={styles.spicyRevealWho}>You</Text>
                  <Text style={styles.spicyRevealPick}>
                    {spicyLevelMeta(spicyMyLevel).emoji} {spicyLevelMeta(spicyMyLevel).label}
                  </Text>
                </View>
                <View style={styles.spicyRevealCard}>
                  <Text style={styles.spicyRevealWho}>{partnerName}</Text>
                  <Text style={styles.spicyRevealPick}>
                    {spicyLevelMeta(spicyPartnerLevel).emoji} {spicyLevelMeta(spicyPartnerLevel).label}
                  </Text>
                </View>
              </View>

              {spicyMyLevel === spicyPartnerLevel ? (
                <Text style={styles.spicyMatchText}>
                  {spicyMyLevel === 'mild'
                    ? "Same energy today. Let's see where this goes."
                    : spicyMyLevel === 'medium'
                      ? "You're both feeling it tonight."
                      : "Oh. It's that kind of day."}
                </Text>
              ) : (
                <Text style={styles.spicyMismatchText}>
                  {spicyMismatchCopy(spicyMyLevel, spicyPartnerLevel, partnerName)}
                </Text>
              )}

              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.spicySeeQuestionBtn}
                onPress={() => void loadSpicyQuestionForToday()}
              >
                <Text style={styles.spicySeeQuestionBtnText}>See Today's Question</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!isSpicyPackActive || spicyStage === 3 || spicyStage === 4 ? (
            <>
          <Text style={[styles.todayLabel, isDailyRevealScreen && styles.dailyRevealLabel]}>
            {"TODAY'S QUESTION"}
          </Text>
          <Text style={[styles.dateAccent, isDailyRevealScreen && styles.dailyRevealLabel]}>{todayLabel}</Text>

          <View style={[styles.questionCard, isDailyRevealScreen && styles.dailyRevealQuestionCard]}>
            <Text style={[styles.questionText, isDailyRevealScreen && styles.dailyRevealQuestionText]}>
              {needsAccountSetup ? 'Setting up your account...' : dailyQuestion}
            </Text>
          </View>

          {dailyLoadReady && canSubmitAnswer && dailyState === 'answer' ? (
            <>
              <TextInput
                style={styles.answerInput}
                placeholder="Type your answer here... dig deep"
                placeholderTextColor={`${TEXT}66`}
                value={answer}
                onChangeText={setAnswer}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                activeOpacity={0.9}
                style={[styles.inviteActionButton, { marginTop: 16 }]}
                onPress={submitAnswer}
                disabled={isSubmitting || !canSubmitAnswer}
              >
                <Text style={styles.inviteActionButtonText}>Lock In My Answer</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {dailyLoadReady && canSubmitAnswer && dailyState === 'waiting' ? (
            <View style={styles.waitingWrap}>
              <Text style={styles.waitingText}>{waitingMessage}</Text>
            </View>
          ) : null}

          {dailyLoadReady && canSubmitAnswer && dailyState === 'reveal' ? (
            <View style={styles.revealWrap}>
              <View style={styles.revealHeadingRow}>
                <Ionicons name="sparkles-outline" size={24} color={TEXT_ON_DARK} />
                <Text style={styles.revealHeading}>Today&apos;s Reveal</Text>
              </View>
              <View style={styles.revealCard}>
                <Text style={styles.revealYouLabel}>You said:</Text>
                <Text style={styles.revealBodyText}>{myAnswer}</Text>
              </View>
              <View style={styles.revealCard}>
                <Text style={styles.revealPartnerLabel}>{`${partnerName} said:`}</Text>
                <Text style={styles.revealBodyText}>{partnerAnswer}</Text>
              </View>

              {vaultSaveBanner ? (
                <Text style={styles.vaultSavedBanner}>Saved to your Vault</Text>
              ) : null}

              <TouchableOpacity activeOpacity={0.9} style={styles.vaultButton} onPress={saveToVault}>
                <Text style={styles.inviteActionButtonText}>Save to Vault</Text>
              </TouchableOpacity>
            </View>
          ) : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showPerfectSyncModal}
        transparent
        animationType="none"
        onRequestClose={dismissPerfectSyncModal}
      >
        <Animated.View style={[styles.shareModalRoot, { opacity: perfectSyncOpacity }]}>
          <View style={styles.shareModalOverlay} />
          <View style={styles.perfectSyncModalColumn}>
            <TouchableOpacity
              accessibilityLabel="Close"
              activeOpacity={0.85}
              style={styles.perfectSyncModalCloseBtn}
              onPress={dismissPerfectSyncModal}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close-outline" size={28} color={TEXT_ON_DARK} />
            </TouchableOpacity>
            <ViewShot ref={perfectSyncCardRef} style={styles.perfectSyncCardWrap} options={{ format: 'png' }}>
              <View style={styles.perfectSyncGradientStack}>
                <View style={styles.perfectSyncGradientTop} />
                <View style={styles.perfectSyncGradientBottom} />
              </View>
              <View style={styles.perfectSyncCardContent}>
                <Image source={HOME_LOGO} style={styles.perfectSyncLogo} resizeMode="contain" />
                <View style={styles.perfectSyncCirclesRow}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <View key={i} style={styles.perfectSyncCircleFilled} />
                  ))}
                </View>
                <Text style={styles.perfectSyncTitle}>Perfect Sync</Text>
                <Text style={styles.perfectSyncSubtitle}>We answered as one</Text>
                <Text style={styles.perfectSyncDate}>{todayLabel}</Text>
                <View style={styles.shareCardDivider} />
                <Text style={styles.shareCardTagline}>
                  {"Keep the Spark"}
                </Text>
                <Text style={styles.shareCardDomain}>oursparkapp.com</Text>
              </View>
            </ViewShot>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.shareModalPrimaryButton}
              onPress={onSavePerfectSyncCard}
            >
              <Text style={styles.shareModalPrimaryButtonText}>Save to Camera Roll</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} onPress={dismissPerfectSyncModal} style={styles.shareModalContinueWrap}>
              <Text style={styles.shareModalContinueText}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>

      <Modal
        visible={showMilestoneModal}
        transparent
        animationType="none"
        onRequestClose={dismissMilestoneModal}
      >
        <Animated.View style={[styles.shareModalRoot, { opacity: milestoneModalOpacity }]}>
          <View style={styles.shareModalOverlay} />
          <View style={styles.shareModalCenterColumn}>
            <ViewShot ref={milestoneCardRef} style={styles.milestoneShareCardWrap} options={{ format: 'png' }}>
              <Image source={HOME_LOGO} style={styles.milestoneShareLogo} resizeMode="contain" />
              <View style={styles.milestoneShareRibbonWrap}>
                <Ionicons name="ribbon-outline" size={70} color={SAGE} />
              </View>
              {milestoneData ? (
                <>
                  <Text style={styles.milestoneShareHeading}>
                    {getMilestoneCardHeading(milestoneData.streak)}
                  </Text>
                  <Text style={styles.milestoneShareSubtext}>
                    You and {milestoneData.partnerName} have kept your spark alive for {milestoneData.streak} days
                    straight.
                  </Text>
                  <Text style={styles.milestoneShareBigNumber}>{milestoneData.streak}</Text>
                  <Text style={styles.milestoneShareDaysLabel}>days in sync</Text>
                </>
              ) : null}
              <View style={styles.shareCardDivider} />
              <Text style={styles.shareCardTagline}>
                {"Keep the Spark"}
              </Text>
              <Text style={styles.shareCardDomain}>oursparkapp.com</Text>
            </ViewShot>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.shareModalPrimaryButton}
              onPress={onSaveMilestoneCard}
            >
              <Text style={styles.shareModalPrimaryButtonText}>Save to Camera Roll</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} onPress={dismissMilestoneModal} style={styles.shareModalContinueWrap}>
              <Text style={styles.shareModalContinueText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>

      <Modal
        visible={showPackCompleteModal}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowPackCompleteModal(false)}
      >
        <View style={[styles.packDoneRoot, { backgroundColor: completedPack?.color ?? PURPLE }]}>
          <ScrollView style={styles.flex} contentContainerStyle={styles.packDoneContent}>
            <Text style={styles.packDoneEmoji}>{completedPack?.emoji ?? '🎉'}</Text>
            <Text style={styles.packDoneTitle}>Pack Complete!</Text>
            <Text style={styles.packDoneName}>{completedPack?.name ?? 'Your Pack'}</Text>
            <Text style={styles.packDoneBody}>You showed up every day. That's the whole thing.</Text>
            <Text style={styles.packDoneSub}>Regular questions resume tomorrow.</Text>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.packDoneBtn}
              onPress={() => {
                setShowPackCompleteModal(false);
                navigation.navigate('Dashboard');
              }}
            >
              <Text style={[styles.packDoneBtnText, { color: completedPack?.color ?? PURPLE }]}>
                Back to Dashboard
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {badgeToast ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.badgeToastOuter, { transform: [{ translateY: badgeToastTranslateY }] }]}
        >
          <View style={styles.badgeToastInner}>
            <Ionicons name="ribbon-outline" size={20} color={ORANGE} />
            <Text style={styles.badgeToastText}>Badge Unlocked: {badgeToast}</Text>
          </View>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loadingRoot}>
      <ActivityIndicator size="large" color={ORANGE} />
      <Text style={styles.loadingHint}>OurSpark</Text>
    </View>
  );
}

function SessionBootLoadingScreen() {
  return (
    <View style={styles.sessionBootLoadingRoot}>
      <ActivityIndicator size="small" color={PURPLE} />
    </View>
  );
}

type AuthMode = 'login' | 'signup';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function attachUserToCouple(userId: string, coupleId: string): Promise<{ error: unknown | null }> {
  const updateResult = await supabase
    .from('profiles')
    .update({ couple_id: coupleId })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (updateResult.error) {
    return { error: updateResult.error };
  }

  if (!updateResult.data) {
    const upsertResult = await supabase
      .from('profiles')
      .upsert({ id: userId, couple_id: coupleId }, { onConflict: 'id' });

    return { error: upsertResult.error };
  }

  return { error: null };
}

function InviteStageTabBar({
  onPressTab,
}: {
  onPressTab: (name: keyof MainTabParamList) => void;
}) {
  const insets = useSafeAreaInsets();
  const tabs: {
    name: keyof MainTabParamList;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
  }[] = [
    { name: 'Dashboard', label: 'Dashboard', icon: 'grid-outline' },
    { name: 'Question', label: 'Today', icon: 'sunny-outline' },
    { name: 'Packs', label: 'Packs', icon: 'cube-outline' },
    { name: 'Vault', label: 'Vault', icon: 'heart-outline' },
    { name: 'Badges', label: 'Badges', icon: 'ribbon-outline' },
  ];

  return (
    <View
      style={[
        styles.inviteStageTabBarRoot,
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      {tabs.map(({ name, label, icon }) => (
        <TouchableOpacity
          key={name}
          style={styles.inviteStageTabItem}
          activeOpacity={0.7}
          onPress={() => onPressTab(name)}
        >
          <Ionicons name={icon} size={24} color={`${TEXT}66`} />
          <Text style={styles.inviteStageTabLabel}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function InviteCodeScreen({
  userId,
  suppressCoupledAutoRedirect,
  onComplete,
  onNavigateToMainTab,
}: {
  userId: string;
  suppressCoupledAutoRedirect: boolean;
  onComplete: () => void;
  onNavigateToMainTab: (name: keyof MainTabParamList) => void;
}) {
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [showCodeCopied, setShowCodeCopied] = useState(false);
  const copyConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyConfirmTimeoutRef.current) {
        clearTimeout(copyConfirmTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const checkExistingCouple = async () => {
      setIsLoadingProfile(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('couple_id')
        .eq('id', userId)
        .maybeSingle();

      if (!isActive) {
        return;
      }

      if (!error && data?.couple_id) {
        if (!suppressCoupledAutoRedirect) {
          onComplete();
          return;
        }

        const { data: coupleRow, error: coupleFetchError } = await supabase
          .from('couples')
          .select('invite_code')
          .eq('id', data.couple_id)
          .maybeSingle();

        if (!isActive) {
          return;
        }

        if (!coupleFetchError && typeof coupleRow?.invite_code === 'string') {
          const trimmed = coupleRow.invite_code.trim();
          setInviteCode(trimmed.length > 0 ? trimmed : null);
        }

        setIsLoadingProfile(false);
        return;
      }

      setIsLoadingProfile(false);
    };

    checkExistingCouple();

    return () => {
      isActive = false;
    };
  }, [onComplete, suppressCoupledAutoRedirect, userId]);

  const createCouple = async () => {
    setErrorMessage('');
    setIsWorking(true);
    const createdCode = generateInviteCode();

    const { data, error } = await supabase
      .from('couples')
      .insert({ invite_code: createdCode })
      .select('id')
      .single();

    if (error || !data?.id) {
      setErrorMessage('Something went wrong while creating your spark. Please try again.');
      setIsWorking(false);
      return;
    }

    const attachResult = await attachUserToCouple(userId, data.id);
    if (attachResult.error) {
      setErrorMessage('Something went wrong while linking your profile. Please try again.');
      setIsWorking(false);
      return;
    }

    setInviteCode(createdCode);
    setIsWorking(false);
  };

  const joinCouple = async () => {
    setErrorMessage('');
    setIsWorking(true);
    const normalizedCode = joinCode.trim().toUpperCase();

    const { data: couple, error: coupleError } = await supabase
      .from('couples')
      .select('id')
      .eq('invite_code', normalizedCode)
      .maybeSingle();

    if (coupleError || !couple?.id) {
      setErrorMessage("Code not found. Check with your partner and try again.");
      setIsWorking(false);
      return;
    }

    const attachResult = await attachUserToCouple(userId, couple.id);
    if (attachResult.error) {
      setErrorMessage('Something went wrong while linking your profile. Please try again.');
      setIsWorking(false);
      return;
    }

    setIsWorking(false);
    onComplete();
  };

  const copyInviteCode = async () => {
    if (!inviteCode) {
      return;
    }
    const six = inviteCode.slice(0, 6);
    await Clipboard.setStringAsync(six);
    setShowCodeCopied(true);
    if (copyConfirmTimeoutRef.current) {
      clearTimeout(copyConfirmTimeoutRef.current);
    }
    copyConfirmTimeoutRef.current = setTimeout(() => {
      setShowCodeCopied(false);
      copyConfirmTimeoutRef.current = null;
    }, 2000);
  };

  const shareInviteCode = async () => {
    if (!inviteCode) {
      return;
    }
    const six = inviteCode.slice(0, 6);
    await Share.share({
      message: `Hey! Join me on OurSpark - our code is: ${six}. Download OurSpark on the App Store: https://apps.apple.com/us/app/ourspark/id6762099560`,
    });
  };

  if (isLoadingProfile) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.flex}>
          <View style={styles.loadingRoot}>
            <ActivityIndicator size="large" color={ORANGE} />
          </View>
          <InviteStageTabBar onPressTab={onNavigateToMainTab} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.inviteScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.inviteHeading}>Connect With Your Partner</Text>
            <Text style={styles.inviteSubheading}>Create a new spark or join your partner&apos;s</Text>

            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.inviteActionButton}
              onPress={createCouple}
              disabled={isWorking}
            >
              <Text style={styles.inviteActionButtonText}>Create Our Spark</Text>
            </TouchableOpacity>

            {inviteCode ? (
              <View style={styles.generatedCodeWrap}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.generatedCodeButton}
                  onPress={() => void copyInviteCode()}
                >
                  <Text style={styles.generatedCodeText}>{inviteCode}</Text>
                </TouchableOpacity>
                <Text
                  style={showCodeCopied ? styles.generatedCodeCopiedHint : styles.generatedCodeTapHint}
                >
                  {showCodeCopied ? 'Code copied!' : 'Tap to copy'}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.invitePrimaryButton}
                  onPress={() => void shareInviteCode()}
                  disabled={isWorking}
                >
                  <Text style={styles.invitePrimaryButtonText}>Share Your Code</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.8} onPress={onComplete} disabled={isWorking}>
                  <Text style={styles.inviteGoDashboardLink}>Go to Dashboard</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.orLine} />
            </View>

            <TextInput
              style={styles.authInput}
              placeholder="Enter your partner's code"
              placeholderTextColor={`${TEXT}66`}
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.inviteActionButton}
              onPress={joinCouple}
              disabled={isWorking}
            >
              <Text style={styles.inviteActionButtonText}>Join Our Spark</Text>
            </TouchableOpacity>

            {errorMessage ? <Text style={styles.inviteError}>{errorMessage}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
        <InviteStageTabBar onPressTab={onNavigateToMainTab} />
      </View>
    </SafeAreaView>
  );
}

function AuthScreen({
  mode,
  onSubmit,
  onForgotPassword,
  onSwitchMode,
}: {
  mode: AuthMode;
  onSubmit: (payload: {
    mode: AuthMode;
    firstName: string;
    email: string;
    password: string;
  }) => Promise<string | null>;
  onForgotPassword: (email: string) => Promise<void>;
  onSwitchMode: () => void;
}) {
  const isLogin = mode === 'login';
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [authError, setAuthError] = useState('');
  const handleSubmit = async () => {
    setAuthError('');
    const errorMessage = await onSubmit({ mode, firstName, email, password });
    if (errorMessage) {
      setAuthError(errorMessage);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Image source={HOME_LOGO} style={styles.authLogo} resizeMode="contain" />
          {isLogin ? <Text style={styles.loginTagline}>The spark starts here.</Text> : null}

          {!isLogin && (
            <TextInput
              style={styles.authInput}
              placeholder="First Name"
              placeholderTextColor={`${TEXT}66`}
              value={firstName}
              onChangeText={setFirstName}
            />
          )}

          <TextInput
            style={styles.authInput}
            placeholder="Email"
            placeholderTextColor={`${TEXT}66`}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View style={styles.authPasswordRow}>
            {/* PASSWORD FIELD - DO NOT REMOVE: textContentType="oneTimeCode" autoComplete="off" required to disable iOS autofill */}
            <TextInput
              style={styles.authPasswordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={`${TEXT}33`}
              secureTextEntry={!showPassword}
              textContentType="oneTimeCode"
              autoComplete="off"
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="default"
              importantForAutofill="no"
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                size={20}
                color={TEXT_ON_DARK}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.92}
            style={styles.authButtonOuter}
            onPress={handleSubmit}
          >
            <Text style={styles.authButtonText}>{isLogin ? 'Sign In' : 'Create My Account'}</Text>
          </TouchableOpacity>
          {isLogin ? (
            <TouchableOpacity activeOpacity={0.8} onPress={() => void onForgotPassword(email)}>
              <Text style={styles.authForgotText}>Forgot your password?</Text>
            </TouchableOpacity>
          ) : null}
          {authError ? <Text style={styles.authErrorText}>{authError}</Text> : null}

          <TouchableOpacity activeOpacity={0.8} onPress={onSwitchMode}>
            <Text style={styles.authSwitchText}>
              {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type VaultMomentDisplay = {
  id: string;
  questionText: string;
  youSaid: string;
  theySaid: string;
  savedAtLabel: string;
};

type BadgeDisplayRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
};

function formatBadgeEarnedDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function BadgesScreen({
  userId,
  onOpenSubscriptionPlans,
}: {
  userId: string;
  onOpenSubscriptionPlans: (coupleId: string, userId: string) => void;
}) {
  const [allBadges, setAllBadges] = useState<Record<string, unknown>[]>([]);
  const [coupleBadges, setCoupleBadges] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState(false);
  const [hasCouple, setHasCouple] = useState(false);
  const [coupleId, setCoupleId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBadges() {
      setLoading(true);
      console.log('Fetching badges...');

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      console.log('Current user:', JSON.stringify(user));
      console.log('Auth error:', JSON.stringify(authError));

      const effectiveUserId = user?.id ?? userId;
      if (!effectiveUserId) {
        console.log('No user id; skipping badge fetches');
        setAllBadges([]);
        setCoupleBadges([]);
        setIsPro(false);
        setHasCouple(false);
        setCoupleId(null);
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('couple_id')
        .eq('id', effectiveUserId)
        .single();

      console.log('Profile:', JSON.stringify(profile));
      console.log('Profile error:', JSON.stringify(profileError));

      if (profile?.couple_id != null) {
        const cid = String(profile.couple_id);
        setHasCouple(true);
        setCoupleId(cid);
        setIsPro(await checkIsPro(cid));
      } else {
        setHasCouple(false);
        setCoupleId(null);
        setIsPro(false);
      }

      const { data: allBadgesData, error: badgesError } = await supabase.from('badges').select('*');
      console.log('All badges:', JSON.stringify(allBadgesData));
      console.log('Badges error:', JSON.stringify(badgesError));

      if (badgesError) {
        setAllBadges([]);
      } else {
        setAllBadges((allBadgesData ?? []) as Record<string, unknown>[]);
      }

      if (profile?.couple_id != null) {
        const { data: coupleBadgesData, error: coupleBadgesError } = await supabase
          .from('couple_badges')
          .select('*')
          .eq('couple_id', profile.couple_id);
        console.log('Couple badges:', JSON.stringify(coupleBadgesData));
        console.log('Couple badges error:', JSON.stringify(coupleBadgesError));
        setCoupleBadges((coupleBadgesData ?? []) as Record<string, unknown>[]);
      } else {
        console.log('Couple badges:', JSON.stringify([]));
        console.log('Couple badges error:', JSON.stringify(null));
        setCoupleBadges([]);
      }

      setLoading(false);
    }

    void fetchBadges();
  }, [userId]);

  const rows = useMemo((): BadgeDisplayRow[] => {
    const earnedBadgeIds = new Set(
      coupleBadges.map((cb) => (cb.badge_id != null ? String(cb.badge_id) : '')).filter(Boolean)
    );
    const earnedAtByBadgeId = new Map<string, string>();
    for (const e of coupleBadges) {
      const bid = e.badge_id != null ? String(e.badge_id) : '';
      const at = typeof e.earned_at === 'string' ? e.earned_at : '';
      if (bid && at) {
        earnedAtByBadgeId.set(bid, at);
      }
    }

    const merged: BadgeDisplayRow[] = allBadges.map((b) => {
      const id = b.id != null ? String(b.id) : '';
      const earned = id !== '' && earnedBadgeIds.has(id);
      return {
        id,
        slug: typeof b.slug === 'string' ? b.slug : '',
        name: typeof b.name === 'string' ? b.name : 'Badge',
        description: typeof b.description === 'string' ? b.description : '',
        icon: typeof b.icon === 'string' ? b.icon : 'ribbon-outline',
        earned,
        earnedAt: earned ? earnedAtByBadgeId.get(id) ?? null : null,
      };
    });

    merged.sort((a, b) => {
      if (a.earned && !b.earned) {
        return -1;
      }
      if (!a.earned && b.earned) {
        return 1;
      }
      if (a.earned && b.earned && a.earnedAt && b.earnedAt) {
        return new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime();
      }
      return a.slug.localeCompare(b.slug);
    });

    return merged;
  }, [allBadges, coupleBadges]);

  const earnedCount = useMemo(() => rows.filter((r) => r.earned).length, [rows]);
  const badgesCountLabel =
    earnedCount === 0
      ? 'Start your journey to earn badges'
      : earnedCount === 1
        ? '1 badge earned'
        : `${earnedCount} badges earned`;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.badgesHeader}>
        <Text style={styles.badgesHeaderTitle}>Your Badges</Text>
        <Text style={styles.badgesHeaderSub}>Milestones you&apos;ve earned together</Text>
      </View>

      <View style={styles.badgesStatsBar}>
        <Text style={styles.badgesStatsText}>{badgesCountLabel}</Text>
      </View>

      {loading ? (
        <View style={styles.badgesLoadingWrap}>
          <ActivityIndicator size="small" color={PURPLE} />
        </View>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.badgesScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.badgesGrid}>
            {rows.map((item) => {
              const isFreeBadge = FREE_BADGE_SLUGS.has(item.slug);

              return (
                <View key={item.id} style={styles.badgeCell}>
                  {item.earned ? (
                    <View style={[styles.badgeCard, styles.badgeCardEarned]}>
                      <Ionicons
                        name={item.icon as keyof typeof Ionicons.glyphMap}
                        size={36}
                        color={ORANGE}
                      />
                      <Text style={styles.badgeNameEarned}>{item.name}</Text>
                      <Text style={styles.badgeDesc}>{item.description}</Text>
                      {item.earnedAt ? (
                        <Text style={styles.badgeDate}>{formatBadgeEarnedDate(item.earnedAt)}</Text>
                      ) : null}
                    </View>
                  ) : isFreeBadge ? (
                    <View style={[styles.badgeCard, styles.badgeCardLocked]}>
                      <Ionicons
                        name={item.icon as keyof typeof Ionicons.glyphMap}
                        size={36}
                        color={PURPLE}
                        style={styles.badgeIconLocked}
                      />
                      <Text style={styles.badgeNameFreePending}>{item.name}</Text>
                      <Text style={styles.badgeDescFreePending}>{item.description}</Text>
                    </View>
                  ) : (
                    <View style={[styles.badgeCard, styles.badgeCardProOnlyMinimal]}>
                      <Text style={styles.badgeProOnlyName}>{item.name}</Text>
                      <Ionicons name="lock-closed-outline" size={24} color={ORANGE} />
                      {PRO_LABEL_BADGE_NAMES.has(item.name) ? (
                        <Text style={styles.badgeProOnlyPill}>PRO</Text>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {!isPro && hasCouple && coupleId ? (
            <View style={styles.badgesProUpgradeCard}>
              <Text style={styles.badgesProUpgradeTitle}>More badges dropping soon.</Text>
              <Text style={styles.badgesProUpgradeBody}>Unlock every badge - for both of you.</Text>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.proUpgradeBtn}
                onPress={() => onOpenSubscriptionPlans(coupleId, userId)}
              >
                <Text style={styles.proUpgradeBtnText}>Unlock Everything</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function VaultScreen({
  userId,
  onOpenSubscriptionPlans,
}: {
  userId: string;
  onOpenSubscriptionPlans: (coupleId: string, userId: string) => void;
}) {
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const [loading, setLoading] = useState(true);
  const [moments, setMoments] = useState<VaultMomentDisplay[]>([]);
  const [firstVaultDateLabel, setFirstVaultDateLabel] = useState('');
  const [activeCoupleId, setActiveCoupleId] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [hasCouple, setHasCouple] = useState(false);
  const [vaultPartnerSaidLabel, setVaultPartnerSaidLabel] = useState(`${PARTNER_HEADING_FALLBACK} said:`);

  const loadVault = useCallback(async () => {
    setLoading(true);
    const { data: profile } = await supabase
      .from('profiles')
      .select('couple_id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.couple_id) {
      setMoments([]);
      setFirstVaultDateLabel('');
      setIsPro(false);
      setHasCouple(false);
      setActiveCoupleId(null);
      setVaultPartnerSaidLabel(`${PARTNER_HEADING_FALLBACK} said:`);
      setLoading(false);
      return;
    }

    setHasCouple(true);

    const coupleId = String(profile.couple_id);
    setActiveCoupleId(coupleId);
    const vaultPartnerRow = await fetchPartnerProfileRow(coupleId, userId);
    setVaultPartnerSaidLabel(`${partnerHeadingFirstName(vaultPartnerRow)} said:`);
    const pro = await checkIsPro(coupleId);
    setIsPro(pro);

    const { data: vaultRows, error: vaultError } = await supabase
      .from('vault')
      .select('*')
      .eq('couple_id', coupleId)
      .order('saved_at', { ascending: false });

    if (vaultError || !vaultRows?.length) {
      setMoments([]);
      setFirstVaultDateLabel('');
      setLoading(false);
      return;
    }

    const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filteredVaultRows = pro
      ? vaultRows
      : vaultRows.filter((row) => {
          const r = row as Record<string, unknown>;
          const raw = r.saved_at ?? r.created_at;
          if (!raw) {
            return false;
          }
          return new Date(String(raw)).getTime() >= cutoffMs;
        });

    const questionIds = [
      ...new Set(
        filteredVaultRows
          .map((row) => {
            const r = row as Record<string, unknown>;
            return r.question_id != null ? String(r.question_id) : '';
          })
          .filter(Boolean)
      ),
    ];

    const { data: questionRows } =
      questionIds.length > 0
        ? await supabase.from('questions').select('*').in('id', questionIds)
        : { data: [] as Record<string, unknown>[] };

    const questionTextById = new Map<string, string>();
    (questionRows ?? []).forEach((q) => {
      const qm = q as Record<string, unknown>;
      const id = qm.id != null ? String(qm.id) : '';
      const text = readQuestionTextFromRow(qm);
      if (id && text) {
        questionTextById.set(id, text);
      }
    });

    const { data: answerRows } =
      questionIds.length > 0
        ? await supabase
            .from('answers')
            .select('*')
            .eq('couple_id', coupleId)
            .in('question_id', questionIds)
        : { data: [] as Record<string, unknown>[] };

    const answersByQuestionId = new Map<string, Record<string, unknown>[]>();
    (answerRows ?? []).forEach((a) => {
      const am = a as Record<string, unknown>;
      const qid = am.question_id != null ? String(am.question_id) : '';
      if (!qid) {
        return;
      }
      const list = answersByQuestionId.get(qid) ?? [];
      list.push(am);
      answersByQuestionId.set(qid, list);
    });

    const built: VaultMomentDisplay[] = filteredVaultRows.map((row) => {
      const r = row as Record<string, unknown>;
      const qid = r.question_id != null ? String(r.question_id) : '';
      const list = answersByQuestionId.get(qid) ?? [];
      const mine = list.find((ans) => String(ans.user_id ?? '') === userId);
      const partner = list.find((ans) => String(ans.user_id ?? '') !== userId);
      const rawSaved = r.saved_at ?? r.created_at;
      const savedDate = rawSaved ? new Date(String(rawSaved)) : new Date();
      const savedAtLabel = savedDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      return {
        id: String(r.id ?? Math.random()),
        questionText: questionTextById.get(qid) ?? '-',
        youSaid: readAnswerTextFromRow(mine ?? {}),
        theySaid: readAnswerTextFromRow(partner ?? {}),
        savedAtLabel,
      };
    });

    const oldest = [...filteredVaultRows].sort((a, b) => {
      const ra = (a as Record<string, unknown>).saved_at ?? (a as Record<string, unknown>).created_at;
      const rb = (b as Record<string, unknown>).saved_at ?? (b as Record<string, unknown>).created_at;
      const ta = ra ? new Date(String(ra)).getTime() : 0;
      const tb = rb ? new Date(String(rb)).getTime() : 0;
      return ta - tb;
    })[0];
    const oldestRaw = oldest
      ? (oldest as Record<string, unknown>).saved_at ?? (oldest as Record<string, unknown>).created_at
      : null;
    if (oldestRaw) {
      const d = new Date(String(oldestRaw));
      setFirstVaultDateLabel(
        d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      );
    } else {
      setFirstVaultDateLabel('');
    }

    setMoments(built);
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadVault();
    }, [loadVault])
  );

  const goToToday = () => {
    navigation.navigate('Question');
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={
          !loading && moments.length === 0 ? styles.vaultScrollEmpty : styles.vaultScroll
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.vaultHeaderTitle}>Your Spark Vault</Text>
        <Text style={styles.vaultHeaderSub}>
          {"Every moment you've been perfectly in sync."}
        </Text>

        {!loading && moments.length > 0 ? (
          <View style={styles.vaultStatsBar}>
            <View style={styles.vaultStatsRowLeft}>
              <Ionicons name="flash-outline" size={20} color={ORANGE} />
              <Text style={styles.vaultStatsFire}>{moments.length} Perfect Syncs</Text>
            </View>
            <View style={styles.vaultStatsRowRight}>
              <Ionicons name="calendar-outline" size={16} color={TEXT} />
              <Text style={styles.vaultStatsSince}>Since {firstVaultDateLabel || '-'}</Text>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.vaultLoadingWrap}>
            <ActivityIndicator size="large" color={PURPLE} />
          </View>
        ) : null}

        {!loading && moments.length === 0 ? (
          <View style={styles.vaultEmptyInner}>
            <Ionicons name="heart-outline" size={60} color={TEXT} style={styles.vaultEmptyHeartIcon} />
            <Text style={styles.vaultEmptyTitle}>Your first Perfect Sync moment will live here</Text>
            <Text style={styles.vaultEmptySub}>
              {"Answer today's question together to start building your Vault"}
            </Text>
            <TouchableOpacity activeOpacity={0.92} style={styles.vaultEmptyBtn} onPress={goToToday}>
              <Text style={styles.vaultEmptyBtnText}>{"Answer Today's Question"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && moments.length > 0 ? (
          <View style={styles.vaultListWrap}>
            {moments.map((m, index) => (
              <View key={m.id} style={styles.vaultMomentCard}>
                <View style={styles.vaultCardCornerIcon}>
                  <Ionicons
                    name={index % 2 === 0 ? 'flash-outline' : 'sparkles-outline'}
                    size={16}
                    color={ORANGE}
                  />
                </View>
                <Text style={styles.vaultCardQuestion}>{m.questionText}</Text>
                <View style={styles.vaultCardDivider} />
                <View style={styles.vaultAnswersRow}>
                  <View style={styles.vaultAnswerCol}>
                    <Text style={styles.vaultYouLabel}>You said:</Text>
                    <Text style={styles.vaultAnswerBody}>{m.youSaid || '-'}</Text>
                  </View>
                  <View style={styles.vaultAnswerCol}>
                    <Text style={styles.vaultTheyLabel}>{vaultPartnerSaidLabel}</Text>
                    <Text style={styles.vaultAnswerBody}>{m.theySaid || '-'}</Text>
                  </View>
                </View>
                <Text style={styles.vaultCardDate}>{m.savedAtLabel}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {!loading && hasCouple && !isPro ? (
          <View style={styles.proUpgradeCard}>
            <Text style={styles.proUpgradeTitle}>Your full story lives here.</Text>
            <Text style={styles.proUpgradeBody}>Go Pro to keep moments longer than 7 days.</Text>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.proUpgradeBtn}
              onPress={() => {
                if (activeCoupleId) {
                  onOpenSubscriptionPlans(activeCoupleId, userId);
                }
              }}
            >
              <Text style={styles.proUpgradeBtnText}>Unlock Everything</Text>
            </TouchableOpacity>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

type PackRow = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  tagline: string;
  description: string;
  durationDays: number;
  iapProductId: string;
  isHoliday: boolean;
};

type CouplePackRow = {
  id: string;
  packId: string;
  status: 'active' | 'paused' | 'completed' | 'owned';
  currentDay: number;
  activatedBy: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
};

function parsePackRow(raw: Record<string, unknown>): PackRow | null {
  if (raw.id == null) {
    return null;
  }
  const durationRaw = Number(raw.duration_days ?? raw.duration ?? 0);
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : 'Pack',
    emoji: typeof raw.emoji === 'string' ? raw.emoji : '✨',
    color: typeof raw.color === 'string' ? raw.color : PURPLE,
    tagline: typeof raw.tagline === 'string' ? raw.tagline : 'One question a day.',
    description:
      typeof raw.description === 'string'
        ? raw.description
        : 'A daily path to help you reconnect one question at a time.',
    durationDays: Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : 14,
    iapProductId: getPackIapProductId(typeof raw.name === 'string' ? raw.name : 'Pack'),
    isHoliday: Boolean(raw.is_holiday),
  };
}

function parseCouplePackRow(raw: Record<string, unknown>): CouplePackRow | null {
  if (raw.id == null || raw.pack_id == null) {
    return null;
  }
  const statusRaw = String(raw.status ?? 'owned');
  const status: CouplePackRow['status'] =
    statusRaw === 'active' || statusRaw === 'paused' || statusRaw === 'completed' ? statusRaw : 'owned';
  return {
    id: String(raw.id),
    packId: String(raw.pack_id),
    status,
    currentDay: Math.max(0, Number(raw.current_day ?? 0)),
    activatedBy: raw.activated_by != null ? String(raw.activated_by) : null,
    activatedAt: typeof raw.activated_at === 'string' ? raw.activated_at : null,
    pausedAt: typeof raw.paused_at === 'string' ? raw.paused_at : null,
  };
}

function PacksScreen({
  userId,
  onPurchase,
  getIapPrice,
}: {
  userId: string;
  onPurchase: (productId: string, coupleId: string, userId: string) => Promise<void>;
  getIapPrice: (productId: string, fallback?: string) => string;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const packCardWidth = (screenWidth - 48) / 2;
  const [loading, setLoading] = useState(true);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [couplePacks, setCouplePacks] = useState<CouplePackRow[]>([]);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>(userId);
  const [selectedPack, setSelectedPack] = useState<PackRow | null>(null);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    setToastText(text);
    setTimeout(() => setToastText(null), 2600);
  }, []);

  const loadPacks = useCallback(async () => {
    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? userId;
    setCurrentUserId(uid);

    const { data: profile } = await supabase
      .from('profiles')
      .select('couple_id')
      .eq('id', uid)
      .maybeSingle();
    const cid = profile?.couple_id != null ? String(profile.couple_id) : null;
    setCoupleId(cid);

    const { data: packsRows } = await supabase.from('packs').select('*').order('name', { ascending: true });
    const normalizedPacks = (packsRows ?? [])
      .map((r) => parsePackRow(r as Record<string, unknown>))
      .filter((p): p is PackRow => Boolean(p));
    setPacks(normalizedPacks);

    if (!cid) {
      setCouplePacks([]);
      setLoading(false);
      return;
    }

    const { data: cpRows } = await supabase
      .from('couple_packs')
      .select('*')
      .eq('couple_id', cid)
      .order('activated_at', { ascending: false });
    const normalizedCouplePacks = (cpRows ?? [])
      .map((r) => parseCouplePackRow(r as Record<string, unknown>))
      .filter((r): r is CouplePackRow => Boolean(r));
    setCouplePacks(normalizedCouplePacks);
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void loadPacks();
    }, [loadPacks])
  );

  const activeCouplePack = useMemo(() => {
    const activeOrPaused = couplePacks.find((r) => r.status === 'active' || r.status === 'paused');
    return activeOrPaused ?? null;
  }, [couplePacks]);

  const activePack = useMemo(() => {
    if (!activeCouplePack) {
      return null;
    }
    return packs.find((p) => p.id === activeCouplePack.packId) ?? null;
  }, [activeCouplePack, packs]);

  const ownedPackIds = useMemo(() => new Set(couplePacks.map((r) => r.packId)), [couplePacks]);
  const couplePackByPackId = useMemo(() => {
    const map = new Map<string, CouplePackRow>();
    for (const cp of couplePacks) {
      if (!map.has(cp.packId)) {
        map.set(cp.packId, cp);
      }
    }
    return map;
  }, [couplePacks]);
  const orderedPacks = useMemo(() => {
    const order = [
      'Spicy Pack',
      'Dream Life Pack',
      'Silly Pack',
      'The Deep End',
      'Still Us Pack',
      'Spring Forward',
    ];
    const rank = new Map(order.map((name, idx) => [name, idx]));
    const statusRank = (pack: PackRow): number => {
      const cp = couplePackByPackId.get(pack.id);
      if (cp?.status === 'active') {
        return 0;
      }
      if (ownedPackIds.has(pack.id)) {
        return 1;
      }
      return 2;
    };
    return [...packs].sort((a, b) => {
      const statusDelta = statusRank(a) - statusRank(b);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      const rankDelta = (rank.get(a.name) ?? 999) - (rank.get(b.name) ?? 999);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return a.name.localeCompare(b.name);
    });
  }, [couplePackByPackId, ownedPackIds, packs]);

  const canManageActivePack = Boolean(
    activeCouplePack && activeCouplePack.activatedBy && activeCouplePack.activatedBy === currentUserId
  );

  const pausePack = useCallback(async () => {
    if (!activeCouplePack) {
      return;
    }
    await supabase
      .from('couple_packs')
      .update({ status: 'paused', paused_at: new Date().toISOString() })
      .eq('id', activeCouplePack.id);
    setShowPauseModal(false);
    await loadPacks();
  }, [activeCouplePack, loadPacks]);

  const resumePack = useCallback(async () => {
    if (!activeCouplePack || !activePack) {
      return;
    }
    await supabase
      .from('couple_packs')
      .update({ status: 'active', paused_at: null })
      .eq('id', activeCouplePack.id);
    showToast(
      `Your ${activePack.name} picks up where you left off. Day ${Math.max(1, activeCouplePack.currentDay + 1)} tomorrow.`
    );
    await loadPacks();
  }, [activeCouplePack, activePack, loadPacks, showToast]);

  const startPack = useCallback(
    async (pack: PackRow) => {
      if (!coupleId) {
        return;
      }
      const existing = couplePackByPackId.get(pack.id);
      let couplePackId: string | null = null;
      if (existing) {
        const { data } = await supabase
          .from('couple_packs')
          .update({
            status: 'active',
            current_day: 1,
            activated_by: currentUserId,
            activated_at: new Date().toISOString(),
            paused_at: null,
          })
          .eq('id', existing.id)
          .select('id')
          .maybeSingle();
        couplePackId = data?.id != null ? String(data.id) : existing.id;
      } else {
        const { data } = await supabase
          .from('couple_packs')
          .insert({
            couple_id: coupleId,
            pack_id: pack.id,
            status: 'active',
            current_day: 1,
            activated_by: currentUserId,
            activated_at: new Date().toISOString(),
            paused_at: null,
          })
          .select('id')
          .maybeSingle();
        couplePackId = data?.id != null ? String(data.id) : null;
      }
      if (couplePackId) {
        await supabase.from('couples').update({ active_pack_id: couplePackId }).eq('id', coupleId);
      }
      showToast(`Your ${pack.name} starts tomorrow. Get ready.`);
      setSelectedPack(null);
      await loadPacks();
    },
    [coupleId, couplePackByPackId, currentUserId, loadPacks, showToast]
  );

  const packPriceLabel = (pack: PackRow): string => {
    if (!pack.iapProductId) {
      return 'Get Pack';
    }
    return getIapPrice(pack.iapProductId, 'Get Pack');
  };

  const renderPackCard = (pack: PackRow) => {
    const cp = couplePackByPackId.get(pack.id);
    const isOwned = ownedPackIds.has(pack.id);
    const isActive = cp?.status === 'active';
    return (
      <TouchableOpacity
        key={pack.id}
        activeOpacity={0.9}
        style={[
          styles.packCard,
          {
            width: packCardWidth,
            height: 180,
            backgroundColor: LINEN,
            borderWidth: 1,
            borderColor: BORDER,
            borderLeftWidth: 4,
            borderLeftColor: pack.color,
          },
        ]}
        onPress={() => setSelectedPack(pack)}
      >
        <View style={styles.packCardContent}>
          <Text style={styles.packCardEmoji}>{pack.emoji}</Text>
          <Text style={styles.packCardName}>{pack.name}</Text>
          <Text style={styles.packCardDescription} numberOfLines={2} ellipsizeMode="tail">
            {pack.description}
          </Text>
          <View style={styles.packCardSpacer} />
        </View>
        <View style={styles.packCardBottomRow}>
          <Text style={styles.packCardPrice}>{isOwned && !isActive ? 'Owned' : packPriceLabel(pack)}</Text>
          <Text style={styles.packCardDuration}>{pack.durationDays} days</Text>
        </View>
        {isOwned && !isActive ? (
          <View style={styles.packOwnedBadge}>
            <Text style={styles.packOwnedBadgeText}>Owned</Text>
          </View>
        ) : null}
        {isActive ? (
          <View style={[styles.packOwnedBadge, styles.packActiveBadge]}>
            <Text style={[styles.packOwnedBadgeText, styles.packActiveBadgeText]}>Active</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const selectedCouplePack = selectedPack ? couplePackByPackId.get(selectedPack.id) ?? null : null;
  const selectedOwned = selectedPack ? ownedPackIds.has(selectedPack.id) : false;
  const selectedIsPaused = Boolean(selectedCouplePack?.status === 'paused');
  const selectedIsActive = Boolean(selectedCouplePack?.status === 'active');
  const packsForGrid = useMemo(
    () =>
      orderedPacks.filter((pack) => {
        if (!activeCouplePack) {
          return true;
        }
        return pack.id !== activeCouplePack.packId;
      }),
    [activeCouplePack, orderedPacks]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.packsHeaderTitle}>Packs</Text>
        <Text style={styles.packsHeaderSub}>One question a day. A whole new direction.</Text>

        {activePack && activeCouplePack ? (
          <>
            <Text style={styles.packsSectionLabel}>ACTIVE PACK</Text>
            <TouchableOpacity
              activeOpacity={activeCouplePack.status === 'paused' ? 0.9 : 1}
              style={[
                styles.activePackCard,
                {
                  backgroundColor: `${PURPLE}18`,
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderLeftWidth: 4,
                  borderLeftColor: activePack.color,
                },
              ]}
              onPress={() => {
                if (activeCouplePack.status === 'paused') {
                  setSelectedPack(activePack);
                }
              }}
            >
              <View style={styles.activePackTop}>
                <Text style={styles.activePackEmoji}>{activePack.emoji}</Text>
                <Text style={styles.activePackName}>{activePack.name}</Text>
              </View>
              <Text style={styles.activePackDayText}>
                Day {Math.max(1, activeCouplePack.currentDay)} of {activePack.durationDays}
              </Text>
              {activeCouplePack.status === 'active' ? (
                <View style={styles.activePackStatusRow}>
                  <View style={styles.activePackDot} />
                  <Text style={styles.activePackStatusActive}>Active</Text>
                </View>
              ) : (
                <Text style={styles.activePackPausedText}>
                  Paused · Day {Math.max(1, activeCouplePack.currentDay)}
                </Text>
              )}
              {canManageActivePack && activeCouplePack.status === 'active' ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.activePackPauseBtn}
                  onPress={() => setShowPauseModal(true)}
                >
                  <Text style={styles.activePackPauseBtnText}>Pause</Text>
                </TouchableOpacity>
              ) : null}
              {canManageActivePack && activeCouplePack.status === 'paused' ? (
                <TouchableOpacity activeOpacity={0.9} style={styles.activePackResumeBtn} onPress={() => void resumePack()}>
                  <Text style={[styles.activePackResumeBtnText, { color: activePack.color }]}>Resume Pack</Text>
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          </>
        ) : null}

        <View
          style={[
            styles.packGrid,
            activePack && activeCouplePack ? styles.packGridAfterActive : null,
          ]}
        >
          {packsForGrid.map((pack) => renderPackCard(pack))}
        </View>

        {loading ? (
          <View style={styles.packsLoadingWrap}>
            <ActivityIndicator size="small" color={ORANGE} />
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={showPauseModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPauseModal(false)}
      >
        <View style={styles.pauseOverlay}>
          <View style={styles.pauseCard}>
            <Text style={styles.pauseTitle}>Taking a break from the {activePack?.name ?? 'Pack'}?</Text>
            <Text style={styles.pauseBody}>
              No worries. Your regular OurSpark questions will pick back up tomorrow. Your pack will be right here
              when you&apos;re ready.
            </Text>
            <TouchableOpacity activeOpacity={0.9} style={styles.pauseConfirmBtn} onPress={() => void pausePack()}>
              <Text style={styles.pauseConfirmBtnText}>Pause Pack</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} style={styles.pauseCancelBtn} onPress={() => setShowPauseModal(false)}>
              <Text style={styles.pauseCancelBtnText}>Keep Going</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={selectedPack !== null} animationType="slide" presentationStyle="fullScreen">
        <View style={[styles.packDetailRoot, { backgroundColor: selectedPack?.color ?? PURPLE }]}>
          <TouchableOpacity
            accessibilityLabel="Close"
            onPress={() => setSelectedPack(null)}
            style={styles.packDetailClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close-outline" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {selectedPack ? (
            <ScrollView style={styles.flex} contentContainerStyle={styles.packDetailContent}>
              <Text style={styles.packDetailEmoji}>{selectedPack.emoji}</Text>
              <Text style={styles.packDetailName}>{selectedPack.name}</Text>
              <Text style={styles.packDetailTagline}>{selectedPack.tagline}</Text>
              <Text style={styles.packDetailDuration}>
                {selectedPack.durationDays} days · one question per day
              </Text>
              <View style={styles.packDetailDivider} />
              <Text style={styles.packDetailDescription}>{selectedPack.description}</Text>
              {!selectedOwned && selectedPack.iapProductId ? (
                <Text style={styles.packDetailPrice}>{packPriceLabel(selectedPack)}</Text>
              ) : null}

              {!selectedOwned ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.packDetailPrimaryBtn}
                  onPress={() => {
                    if (selectedPack.iapProductId && coupleId) {
                      void onPurchase(selectedPack.iapProductId, coupleId, userId);
                    } else {
                      Alert.alert('Unavailable', 'This pack is not available for purchase yet.');
                    }
                  }}
                >
                  <Text style={[styles.packDetailPrimaryBtnText, { color: selectedPack.color }]}>
                    Get This Pack
                  </Text>
                </TouchableOpacity>
              ) : selectedIsPaused ? (
                <>
                  <View style={styles.packDetailDisabledBtn}>
                    <Text style={styles.packDetailDisabledBtnText}>Paused</Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={styles.packDetailPrimaryBtn}
                    onPress={() => {
                      void resumePack();
                      setSelectedPack(null);
                    }}
                  >
                    <Text style={[styles.packDetailPrimaryBtnText, { color: selectedPack.color }]}>Resume</Text>
                  </TouchableOpacity>
                </>
              ) : selectedIsActive ? (
                <>
                  <View style={styles.packDetailDisabledBtn}>
                    <Text style={styles.packDetailDisabledBtnText}>Active</Text>
                  </View>
                  <TouchableOpacity activeOpacity={0.9} style={styles.packDetailPrimaryBtn} onPress={() => setShowPauseModal(true)}>
                    <Text style={[styles.packDetailPrimaryBtnText, { color: selectedPack.color }]}>Pause</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.packDetailPrimaryBtn}
                  onPress={() => void startPack(selectedPack)}
                >
                  <Text style={[styles.packDetailPrimaryBtnText, { color: selectedPack.color }]}>Activate</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {toastText ? (
        <View style={styles.packToastWrap} pointerEvents="none">
          <View style={styles.packToastInner}>
            <Text style={styles.packToastText}>{toastText}</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MainTabs({
  userId,
  onPurchase,
  onOpenSubscriptionPlans,
  getIapPrice,
  onNavigateToPartnerSetup,
}: {
  userId: string;
  onPurchase: (productId: string, coupleId: string, userId: string) => Promise<void>;
  onOpenSubscriptionPlans: (coupleId: string, userId: string) => void;
  getIapPrice: (productId: string, fallback?: string) => string;
  onNavigateToPartnerSetup: () => void;
}) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: BG,
          borderTopColor: BORDER,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 6,
          height: Platform.OS === 'ios' ? 88 : 64,
        },
        tabBarLabelStyle: {
          fontFamily: FONT_BODY,
          fontSize: 12,
          letterSpacing: 0.3,
        },
        tabBarActiveTintColor: PURPLE,
        tabBarInactiveTintColor: `${NAVY}66`,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={24} color={color} />,
        }}
      >
        {() => (
          <DashboardScreen
            userId={userId}
            onOpenSubscriptionPlans={onOpenSubscriptionPlans}
            onNavigateToPartnerSetup={onNavigateToPartnerSetup}
          />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="Question"
        options={{
          tabBarLabel: 'Today',
          tabBarIcon: ({ color }) => <Ionicons name="sunny-outline" size={24} color={color} />,
        }}
      >
        {() => <DailyQuestionScreen userId={userId} />}
      </Tab.Screen>
      <Tab.Screen
        name="Packs"
        options={{
          tabBarLabel: 'Packs',
          tabBarIcon: ({ color }) => <Ionicons name="cube-outline" size={24} color={color} />,
        }}
      >
        {() => (
          <PacksScreen userId={userId} onPurchase={onPurchase} getIapPrice={getIapPrice} />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="Vault"
        options={{
          tabBarLabel: 'Vault',
          tabBarIcon: ({ color }) => <Ionicons name="heart-outline" size={24} color={color} />,
        }}
      >
        {() => <VaultScreen userId={userId} onOpenSubscriptionPlans={onOpenSubscriptionPlans} />}
      </Tab.Screen>
      <Tab.Screen
        name="Badges"
        options={{
          tabBarLabel: 'Badges',
          tabBarIcon: ({ color }) => <Ionicons name="ribbon-outline" size={24} color={color} />,
        }}
      >
        {() => <BadgesScreen userId={userId} onOpenSubscriptionPlans={onOpenSubscriptionPlans} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

async function getProfileCoupleId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('couple_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data?.couple_id ?? null;
}

function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function PersonalizationScreen({
  userId,
  onContinue,
  onSkip,
}: {
  userId: string;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [anniversaryDay, setAnniversaryDay] = useState('');
  const [anniversaryMonth, setAnniversaryMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [partnerBirthdayDay, setPartnerBirthdayDay] = useState('');
  const [partnerBirthdayMonth, setPartnerBirthdayMonth] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const saveAndContinue = async () => {
    setIsSaving(true);
    const { data: authData } = await supabase.auth.getUser();
    const metadataNameRaw = authData.user?.user_metadata as Record<string, unknown> | undefined;
    const metadataName =
      typeof metadataNameRaw?.name === 'string'
        ? metadataNameRaw.name.trim()
        : typeof metadataNameRaw?.first_name === 'string'
          ? metadataNameRaw.first_name.trim()
          : '';

    const payload = {
      anniversary_day: toNullableNumber(anniversaryDay),
      anniversary_month: toNullableNumber(anniversaryMonth),
      birthday_day: toNullableNumber(birthdayDay),
      birthday_month: toNullableNumber(birthdayMonth),
      partner_birthday_day: toNullableNumber(partnerBirthdayDay),
      partner_birthday_month: toNullableNumber(partnerBirthdayMonth),
      ...(metadataName ? { name: metadataName } : {}),
    };

    const updateResult = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select('id')
      .maybeSingle();

    if (updateResult.error || !updateResult.data) {
      await supabase.from('profiles').upsert({ id: userId, ...payload }, { onConflict: 'id' });
    }

    setIsSaving(false);
    onContinue();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.personalizationScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Image source={HOME_LOGO} style={styles.personalizationLogo} resizeMode="contain" />
          <Text style={styles.personalizationHeading}>{"Let's make this yours"}</Text>
          <Text style={styles.personalizationSubheading}>
            Add your special dates so OurSpark can make those days unforgettable. You can always
            add these later.
          </Text>

          <View style={styles.dateSection}>
            <Text style={styles.dateSectionLabel}>Your Anniversary</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={styles.dateInput}
                placeholder="Day"
                placeholderTextColor={`${TEXT}66`}
                value={anniversaryDay}
                onChangeText={setAnniversaryDay}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.dateInput}
                placeholder="Month"
                placeholderTextColor={`${TEXT}66`}
                value={anniversaryMonth}
                onChangeText={setAnniversaryMonth}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.dateSection}>
            <Text style={styles.dateSectionLabel}>Your Birthday</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={styles.dateInput}
                placeholder="Day"
                placeholderTextColor={`${TEXT}66`}
                value={birthdayDay}
                onChangeText={setBirthdayDay}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.dateInput}
                placeholder="Month"
                placeholderTextColor={`${TEXT}66`}
                value={birthdayMonth}
                onChangeText={setBirthdayMonth}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.dateSection}>
            <Text style={styles.dateSectionLabel}>Your Partner's Birthday</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={styles.dateInput}
                placeholder="Day"
                placeholderTextColor={`${TEXT}66`}
                value={partnerBirthdayDay}
                onChangeText={setPartnerBirthdayDay}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.dateInput}
                placeholder="Month"
                placeholderTextColor={`${TEXT}66`}
                value={partnerBirthdayMonth}
                onChangeText={setPartnerBirthdayMonth}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.92}
            style={styles.personalizationButton}
            onPress={saveAndContinue}
            disabled={isSaving}
          >
            <Text style={styles.personalizationButtonText}>Save & Continue</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.8} onPress={onSkip} disabled={isSaving}>
            <Text style={styles.personalizationSkip}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    RedHatDisplay_700Bold,
    Montserrat_400Regular,
  });
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [appStage, setAppStage] = useState<AppStage>('marketing');
  const [inviteFromMainNav, setInviteFromMainNav] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [purchaseToast, setPurchaseToast] = useState<string | null>(null);
  const [mainTabsRefreshKey, setMainTabsRefreshKey] = useState(0);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [planPickerCoupleId, setPlanPickerCoupleId] = useState<string | null>(null);
  const [planPickerUserId, setPlanPickerUserId] = useState<string | null>(null);
  const [iapReady, setIapReady] = useState(false);
  const [iapPricesVersion, setIapPricesVersion] = useState(0);
  const appStageRef = useRef(appStage);
  const pendingNavigateToQuestionRef = useRef(false);
  const invitePendingMainTabRef = useRef<keyof MainTabParamList | null>(null);

  appStageRef.current = appStage;

  useEffect(() => {
    if (appStage !== 'invite') {
      setInviteFromMainNav(false);
    }
  }, [appStage]);

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (!purchaseToast) {
      return;
    }
    const id = setTimeout(() => setPurchaseToast(null), 2500);
    return () => clearTimeout(id);
  }, [purchaseToast]);

  const getIapPrice = useCallback(
    (productId: string, fallback = '') => {
      void iapPricesVersion;
      return getIapFormattedPrice(productId, fallback);
    },
    [iapPricesVersion]
  );

  useEffect(() => {
    if (!isIapSupported()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await connectAndLoadProducts(ALL_IAP_PRODUCT_IDS);
        if (!cancelled) {
          setIapReady(true);
          setIapPricesVersion((v) => v + 1);
        }
      } catch (err) {
        console.warn('IAP init failed:', err);
      }
    })();

    setIapPurchaseSettledHandler((result) => {
      setMainTabsRefreshKey((k) => k + 1);
      if (result.success) {
        if (isProProductId(result.productId)) {
          setPurchaseToast('Welcome to Pro! Everything is now unlocked for both of you.');
          Alert.alert('Welcome to Pro!', 'Everything is now unlocked for both of you.');
        } else {
          setPurchaseToast('Pack unlocked! Head to your Packs tab to start.');
          Alert.alert('Pack unlocked!', 'Head to your Packs tab to start.');
        }
      } else if (result.message !== 'Purchase canceled') {
        Alert.alert('Purchase failed', result.message);
      }
    });

    return () => {
      cancelled = true;
      setIapPurchaseSettledHandler(null);
    };
  }, []);

  const syncSubscriptionForUser = useCallback(async (userId: string) => {
    if (!isIapSupported() || !iapReady) {
      return;
    }
    const coupleId = await getProfileCoupleId(userId);
    if (!coupleId) {
      return;
    }
    await syncProFromPurchaseHistory(coupleId, PRO_IAP_PRODUCT_IDS);
    setMainTabsRefreshKey((k) => k + 1);
  }, [iapReady]);

  useEffect(() => {
    if (!iapReady || !currentUserId || appStage !== 'main') {
      return;
    }
    void syncSubscriptionForUser(currentUserId);
  }, [appStage, currentUserId, iapReady, syncSubscriptionForUser]);

  const handlePurchase = useCallback(
    async (productId: string, coupleId: string, userId: string) => {
      if (!isIapSupported()) {
        Alert.alert('Unavailable', 'In-app purchases are only available in the iOS app.');
        return;
      }
      if (!iapReady) {
        Alert.alert('Store loading', 'The App Store is still loading. Please try again in a moment.');
        return;
      }
      try {
        await startIapPurchase(productId, coupleId, userId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Payment failed';
        Alert.alert('Purchase failed', message);
      }
    },
    [iapReady]
  );

  const handleRestorePurchases = useCallback(async () => {
    if (!planPickerCoupleId || !planPickerUserId) {
      return;
    }
    if (!isIapSupported() || !iapReady) {
      Alert.alert('Unavailable', 'Restore is only available in the iOS app.');
      return;
    }
    try {
      const { restoredPro, restoredPackCount } = await restoreIapPurchases(
        planPickerCoupleId,
        planPickerUserId,
        PRO_IAP_PRODUCT_IDS,
        getPackProductIdToNameMap()
      );
      setMainTabsRefreshKey((k) => k + 1);
      if (restoredPro || restoredPackCount > 0) {
        const parts: string[] = [];
        if (restoredPro) {
          parts.push('Pro subscription');
        }
        if (restoredPackCount > 0) {
          parts.push(`${restoredPackCount} pack${restoredPackCount === 1 ? '' : 's'}`);
        }
        Alert.alert('Restored', `Successfully restored: ${parts.join(' and ')}.`);
        setPurchaseToast('Your purchases have been restored.');
      } else {
        Alert.alert('No purchases found', 'We could not find previous purchases for this Apple ID.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not restore purchases';
      Alert.alert('Restore failed', message);
    }
  }, [iapReady, planPickerCoupleId, planPickerUserId]);

  const openSubscriptionPlans = useCallback((coupleId: string, userId: string) => {
    setPlanPickerCoupleId(coupleId);
    setPlanPickerUserId(userId);
    setShowPlanPicker(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      const initialSession = data.session;
      setSession(initialSession);
      if (initialSession?.user) {
        setCurrentUserId(initialSession.user.id);
        setAppStage('main');
      }
      setAuthReady(true);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setCurrentUserId(null);
        setAppStage('marketing');
        return;
      }
      if (nextSession.user) {
        setCurrentUserId(nextSession.user.id);
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const title = response.notification.request.content.title ?? '';
      const isDailyQuestion = title === 'Your daily question is ready';
      const isReveal = title === 'Your partner just answered!';
      if (!isDailyQuestion && !isReveal) {
        return;
      }
      pendingNavigateToQuestionRef.current = true;
      if (appStageRef.current === 'main' && navigationRef.isReady()) {
        navigationRef.navigate('Question');
        pendingNavigateToQuestionRef.current = false;
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (appStage !== 'main' || !pendingNavigateToQuestionRef.current) {
      return;
    }
    const id = setTimeout(() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate('Question');
        pendingNavigateToQuestionRef.current = false;
      }
    }, 0);
    return () => clearTimeout(id);
  }, [appStage]);

  useEffect(() => {
    if (appStage !== 'main') {
      return;
    }
    const pending = invitePendingMainTabRef.current;
    if (!pending) {
      return;
    }
    invitePendingMainTabRef.current = null;
    const id = setTimeout(() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate(pending);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [appStage]);

  if (!fontsLoaded && !fontError) {
    return <LoadingScreen />;
  }

  if (fontError) {
    console.warn(fontError);
  }

  if (!authReady) {
    return (
      <SafeAreaProvider>
        <SessionBootLoadingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="light" />
        {appStage === 'main' ? (
          <MainTabs
            key={mainTabsRefreshKey}
            userId={currentUserId ?? ''}
            onPurchase={handlePurchase}
            onOpenSubscriptionPlans={openSubscriptionPlans}
            getIapPrice={getIapPrice}
            onNavigateToPartnerSetup={() => {
              setInviteFromMainNav(true);
              setAppStage('invite');
            }}
          />
        ) : appStage === 'personalization' && currentUserId ? (
          <PersonalizationScreen
            userId={currentUserId}
            onContinue={() => setAppStage('invite')}
            onSkip={() => setAppStage('invite')}
          />
        ) : appStage === 'invite' && currentUserId ? (
          <InviteCodeScreen
            userId={currentUserId}
            suppressCoupledAutoRedirect={inviteFromMainNav}
            onComplete={() => setAppStage('main')}
            onNavigateToMainTab={(name) => {
              invitePendingMainTabRef.current = name;
              setAppStage('main');
            }}
          />
        ) : appStage === 'marketing' ? (
          <MarketingHomeScreen
            onBeginOurStory={() => {
              setAuthMode('signup');
              setAppStage('auth');
            }}
            onSignIn={() => {
              setAuthMode('login');
              setAppStage('auth');
            }}
          />
        ) : (
          <AuthScreen
            mode={authMode}
            onSubmit={async ({ mode, firstName, email, password }) => {
              if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({
                  email,
                  password,
                  options: {
                    data: {
                      first_name: firstName,
                    },
                  },
                });
                console.log('Supabase signUp data:', JSON.stringify(data));
                console.log('Supabase signUp error:', JSON.stringify(error));

                if (!error && data?.user?.id) {
                  const trimmedFirstName = firstName.trim();
                  if (trimmedFirstName) {
                    await supabase.from('profiles').upsert(
                      {
                        id: data.user.id,
                        name: trimmedFirstName,
                      },
                      { onConflict: 'id' }
                    );
                  }
                  setCurrentUserId(data.user.id);
                  setAppStage('personalization');
                  return null;
                }
                return error?.message ?? 'Unable to create account. Please try again.';
              }

              const { data, error } = await supabase.auth.signInWithPassword({ email, password });
              if (error || !data.user?.id) {
                return error?.message ?? 'Unable to sign in. Please check your credentials.';
              }

              setCurrentUserId(data.user.id);
              setAppStage('main');
              return null;
            }}
            onForgotPassword={async (email) => {
              const trimmedEmail = email.trim();
              if (!trimmedEmail) {
                Alert.alert('Please enter your email address first.');
                return;
              }

              const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail);
              if (error) {
                Alert.alert(error.message);
                return;
              }

              Alert.alert('Check your email for a password reset link.');
            }}
            onSwitchMode={() => setAuthMode((prev) => (prev === 'login' ? 'signup' : 'login'))}
          />
        )}
        {showPlanPicker ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setShowPlanPicker(false)}>
            <View style={styles.planPickerOverlay}>
              <View style={styles.planPickerCard}>
                <View style={styles.planPickerHeaderRow}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => void handleRestorePurchases()}
                  >
                    <Text style={styles.planPickerRestoreText}>Restore Purchases</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => setShowPlanPicker(false)}
                  >
                    <Text style={styles.planPickerDismissText}>Maybe Later</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.planPickerMonthlyBtn}
                  onPress={() => {
                    if (planPickerCoupleId && planPickerUserId) {
                      void handlePurchase(
                        IAP_PRODUCT_IDS.proMonthly,
                        planPickerCoupleId,
                        planPickerUserId
                      );
                    }
                    setShowPlanPicker(false);
                  }}
                >
                  <Text style={styles.planPickerMonthlyBtnText}>
                    Monthly · {getIapPrice(IAP_PRODUCT_IDS.proMonthly, 'Subscribe')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.planPickerAnnualBtn}
                  onPress={() => {
                    if (planPickerCoupleId && planPickerUserId) {
                      void handlePurchase(
                        IAP_PRODUCT_IDS.proAnnual,
                        planPickerCoupleId,
                        planPickerUserId
                      );
                    }
                    setShowPlanPicker(false);
                  }}
                >
                  <Text style={styles.planPickerAnnualBtnText}>
                    Annual · {getIapPrice(IAP_PRODUCT_IDS.proAnnual, 'Subscribe')} · Save 44%
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        ) : null}
        {purchaseToast ? (
          <View style={styles.purchaseToastWrap} pointerEvents="none">
            <View style={styles.purchaseToastInner}>
              <Text style={styles.purchaseToastText}>{purchaseToast}</Text>
            </View>
          </View>
        ) : null}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sessionBootLoadingRoot: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  loadingHint: {
    fontFamily: FONT_BODY,
    fontSize: 22,
    color: `${TEXT}88`,
    letterSpacing: 2,
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  authLogo: {
    width: 200,
    height: 200,
    alignSelf: 'center',
    marginBottom: 10,
  },
  loginTagline: {
    fontFamily: FONT_BODY,
    fontSize: 18,
    color: TEXT,
    textAlign: 'center',
    marginBottom: 26,
  },
  authInput: {
    backgroundColor: CARD_BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: TEXT,
    fontFamily: FONT_BODY,
    fontSize: 15,
    marginBottom: 12,
  },
  authPasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LINEN,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  authPasswordInput: {
    flex: 1,
    color: TEXT,
    fontFamily: 'Montserrat_400Regular',
    fontSize: 16,
    paddingVertical: 14,
  },
  authEyeButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_BG,
  },
  authEyeText: {
    fontSize: 18,
    color: TEXT,
  },
  authButtonOuter: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: PURPLE,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  authButtonText: {
    fontFamily: FONT_BODY,
    fontSize: 17,
    color: TEXT_ON_DARK,
    letterSpacing: 0.3,
  },
  authForgotText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    opacity: 0.7,
  },
  authSwitchText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
    opacity: 0.95,
  },
  authErrorText: {
    fontFamily: FONT_BODY,
    color: '#FF7575',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  personalizationScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  personalizationLogo: {
    width: 150,
    height: 150,
    alignSelf: 'center',
    marginBottom: 8,
  },
  personalizationHeading: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 32,
    textAlign: 'center',
    marginBottom: 10,
  },
  personalizationSubheading: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  dateSection: {
    marginBottom: 14,
  },
  dateSectionLabel: {
    fontFamily: FONT_BODY,
    color: TEXT,
    textAlign: 'center',
    fontSize: 15,
    marginBottom: 8,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateInput: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: TEXT,
    fontFamily: FONT_BODY,
    fontSize: 15,
    textAlign: 'center',
  },
  personalizationButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: PURPLE,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  personalizationButtonText: {
    fontFamily: FONT_BODY,
    fontSize: 17,
    color: TEXT_ON_DARK,
    letterSpacing: 0.3,
  },
  personalizationSkip: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
    opacity: 0.95,
  },
  inviteScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  inviteHeading: {
    fontFamily: FONT_HEADING,
    fontSize: 34,
    color: TEXT,
    textAlign: 'center',
    marginBottom: 10,
  },
  inviteSubheading: {
    fontFamily: FONT_BODY,
    fontSize: 15,
    color: TEXT,
    textAlign: 'center',
    marginBottom: 24,
  },
  inviteActionButton: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: PURPLE,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  inviteActionButtonText: {
    fontFamily: FONT_BODY,
    fontSize: 16,
    color: TEXT_ON_DARK,
  },
  invitePrimaryButton: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: SAGE,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: SAGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  invitePrimaryButtonText: {
    fontFamily: FONT_BODY,
    fontSize: 16,
    color: TEXT_ON_DARK,
    letterSpacing: 0.3,
  },
  inviteGoDashboardLink: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: TEXT,
    opacity: 0.55,
    textAlign: 'center',
    paddingVertical: 8,
    textDecorationLine: 'underline',
  },
  generatedCodeWrap: {
    alignItems: 'center',
    marginBottom: 4,
  },
  generatedCodeButton: {
    borderWidth: 1,
    borderColor: PURPLE,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  generatedCodeText: {
    fontFamily: FONT_HEADING,
    fontSize: 44,
    color: ORANGE,
    letterSpacing: 3,
  },
  generatedCodeTapHint: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: TEXT,
    marginTop: 8,
    marginBottom: 12,
  },
  generatedCodeCopiedHint: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: ORANGE,
    marginTop: 8,
    marginBottom: 12,
  },
  inviteStageTabBarRoot: {
    flexDirection: 'row',
    backgroundColor: BG,
    borderTopColor: BORDER,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  inviteStageTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  inviteStageTabLabel: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    letterSpacing: 0.3,
    color: `${NAVY}66`,
    marginTop: 2,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: BORDER,
  },
  orText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    marginHorizontal: 10,
    fontSize: 13,
  },
  inviteError: {
    fontFamily: FONT_BODY,
    color: '#FF7575',
    fontSize: 13,
    marginTop: 2,
    textAlign: 'center',
  },
  dashboardScroll: {
    paddingBottom: 32,
  },
  dbGreeting: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 28,
    textAlign: 'left',
    paddingTop: 60,
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  dbDateLine: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 15,
    textAlign: 'left',
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  dbTodayCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    margin: 16,
    padding: 20,
  },
  dbTodayCardGlow: {
    borderWidth: 2,
    borderColor: SAGE,
    shadowColor: SAGE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  dbActivePackLine: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 12,
    textAlign: 'center',
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 8,
  },
  dbStatusSmall: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 12,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 10,
  },
  dbTitleIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  dbTitleIconRowTight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dbTodayTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 0,
    flexShrink: 1,
  },
  dbTodayTitleLocked: {
    fontFamily: FONT_HEADING,
    color: ORANGE,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 0,
    flexShrink: 1,
  },
  dbTodayTitleReveal: {
    fontFamily: FONT_HEADING,
    color: ORANGE,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 0,
    flexShrink: 1,
  },
  dbWaitingSub: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 10,
  },
  dbPulseRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dbPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PURPLE,
  },
  dbAnswerNowBtn: {
    backgroundColor: SAGE,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dbAnswerNowText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  dbRevealReadyWrap: {
    alignItems: 'center',
  },
  dbSeeRevealBtn: {
    backgroundColor: PURPLE,
    borderRadius: 14,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  dbSeeRevealText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  dbStreakRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  dbHalfCard: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
  },
  dbStatEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  dbStatNumberStreak: {
    fontFamily: FONT_HEADING,
    color: ORANGE,
    fontSize: 32,
  },
  dbStatNumberCompat: {
    fontFamily: FONT_HEADING,
    color: PURPLE,
    fontSize: 32,
  },
  dbStatCaption: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  dbStatEmptyText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 12,
    textAlign: 'center',
  },
  dbReflectionCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  dbReflectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dbReflectionLabel: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  dbReflectionBody: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 8,
  },
  dbReflectionEllipsis: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    opacity: 0.5,
    marginTop: 4,
  },
  dbReflectionReadFull: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 13,
    marginTop: 10,
  },
  dbReflectionFooter: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 11,
    opacity: 0.4,
    marginTop: 12,
  },
  dbVaultCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    margin: 16,
    padding: 20,
  },
  dbVaultTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dbVaultTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 0,
  },
  dbStatIconTop: {
    marginBottom: 8,
  },
  dbVaultSub: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  homeInner: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  homeTopSection: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 100,
    width: '100%',
  },
  homeBottomSection: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 40,
  },
  homeLogo: {
    width: Dimensions.get('window').width * 0.65,
    height: Dimensions.get('window').width * 0.65,
    resizeMode: 'contain',
    alignSelf: 'center',
  },
  tagline: {
    fontFamily: FONT_BODY,
    fontSize: 16,
    color: TEXT,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  homeCtaButton: {
    width: '100%',
    maxWidth: 340,
    height: 56,
    borderRadius: 28,
    backgroundColor: PURPLE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  gradientLayerPurple: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PURPLE,
  },
  gradientLayerOrange: {
    position: 'absolute',
    width: '125%',
    height: '220%',
    backgroundColor: ORANGE,
    opacity: 0.82,
    transform: [{ rotate: '28deg' }, { translateX: 48 }],
    top: '-60%',
    right: -36,
  },
  homeCtaText: {
    fontFamily: FONT_BODY,
    fontSize: 17,
    color: TEXT_ON_DARK,
    letterSpacing: 0.4,
  },
  caption: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: TEXT,
    opacity: 0.85,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  dailyScroll: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 12,
  },
  todayPackPill: {
    alignSelf: 'center',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 10,
  },
  todayPackPillText: {
    fontFamily: FONT_BODY,
    color: '#FFFFFF',
    fontSize: 11,
  },
  spicyPickerWrap: {
    paddingTop: 40,
  },
  spicyDayLabel: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: 2,
    textAlign: 'center',
    paddingTop: 40,
  },
  spicyTitle: {
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 28,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 10,
  },
  spicySub: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 10,
  },
  spicyLevelBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  spicyLevelEmoji: {
    fontSize: 28,
  },
  spicyLevelEmojiHot: {
    fontSize: 24,
  },
  spicyLevelTextCol: {
    flex: 1,
  },
  spicyLevelTitle: {
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 20,
  },
  spicyLevelDesc: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  spicyWaitWrap: {
    marginTop: 120,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  spicyWaitTitle: {
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 22,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  spicyWaitDotWrap: {
    marginTop: 16,
    alignItems: 'center',
  },
  spicyWaitDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  spicyRevealWrap: {
    marginTop: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  spicyRevealRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  spicyRevealCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 14,
    alignItems: 'center',
  },
  spicyRevealWho: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  spicyRevealPick: {
    marginTop: 6,
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 22,
    textAlign: 'center',
  },
  spicyMatchText: {
    marginTop: 16,
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 22,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  spicyMismatchText: {
    marginTop: 16,
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  spicySeeQuestionBtn: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  spicySeeQuestionBtnText: {
    fontFamily: FONT_BODY,
    color: '#7B1A1A',
    fontSize: 16,
  },
  todayLabel: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: TEXT,
    letterSpacing: 3.2,
    textAlign: 'center',
    textTransform: 'uppercase',
    opacity: 0.95,
  },
  dateAccent: {
    fontFamily: FONT_BODY,
    fontSize: 15,
    color: PURPLE,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 22,
  },
  questionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  questionText: {
    fontFamily: FONT_BODY,
    fontSize: 18,
    lineHeight: 28,
    color: TEXT,
    textAlign: 'center',
  },
  answerInput: {
    marginTop: 20,
    minHeight: 120,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: CARD_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    fontFamily: FONT_BODY,
    fontSize: 16,
    lineHeight: 22,
    color: TEXT,
  },
  waitingWrap: {
    marginTop: 18,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  waitingText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    textAlign: 'center',
  },
  revealWrap: {
    marginTop: 20,
    gap: 12,
  },
  dailyRevealScreen: {
    backgroundColor: PURPLE,
  },
  dailyRevealLabel: {
    color: TEXT_ON_DARK,
  },
  dailyRevealQuestionCard: {
    backgroundColor: LINEN,
    borderColor: BORDER,
  },
  dailyRevealQuestionText: {
    color: TEXT,
  },
  revealHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  revealHeading: {
    fontFamily: FONT_HEADING,
    color: TEXT_ON_DARK,
    fontSize: 28,
    textAlign: 'center',
    marginBottom: 0,
  },
  revealCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  revealYouLabel: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 12,
    marginBottom: 6,
  },
  revealPartnerLabel: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 12,
    marginBottom: 6,
  },
  revealBodyText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 16,
    lineHeight: 23,
  },
  shareModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  shareModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 2, 54, 0.92)',
  },
  shareModalCenterColumn: {
    width: 320,
    alignItems: 'stretch',
    zIndex: 1,
  },
  perfectSyncModalColumn: {
    width: 320,
    alignItems: 'stretch',
    zIndex: 1,
    position: 'relative',
  },
  perfectSyncModalCloseBtn: {
    position: 'absolute',
    right: 0,
    top: -8,
    zIndex: 4,
    padding: 4,
  },
  perfectSyncCardWrap: {
    width: 320,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: SAGE,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 360,
  },
  perfectSyncGradientStack: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  perfectSyncGradientTop: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  perfectSyncGradientBottom: {
    flex: 1,
    backgroundColor: LINEN,
  },
  perfectSyncCardContent: {
    padding: 32,
    alignItems: 'center',
  },
  perfectSyncLogo: {
    width: 80,
    height: 80,
    alignSelf: 'center',
  },
  perfectSyncCirclesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  perfectSyncCircleFilled: {
    width: 16,
    height: 16,
    borderRadius: 8,
    margin: 4,
    backgroundColor: SAGE,
  },
  perfectSyncTitle: {
    fontFamily: FONT_HEADING,
    color: SAGE,
    fontSize: 32,
    textAlign: 'center',
    marginTop: 12,
  },
  perfectSyncSubtitle: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
  },
  perfectSyncDate: {
    fontFamily: FONT_BODY,
    color: '#841C67',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  shareCardDivider: {
    height: 1,
    backgroundColor: '#841C67',
    opacity: 0.4,
    alignSelf: 'stretch',
    marginVertical: 16,
  },
  shareCardTagline: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.7,
  },
  shareCardDomain: {
    fontFamily: FONT_BODY,
    color: '#841C67',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  shareModalPrimaryButton: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: SAGE,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  shareModalPrimaryButtonText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  shareModalContinueWrap: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  shareModalContinueText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    textAlign: 'center',
  },
  packDoneRoot: {
    flex: 1,
  },
  packDoneContent: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  packDoneEmoji: {
    fontSize: 64,
    textAlign: 'center',
  },
  packDoneTitle: {
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 36,
    textAlign: 'center',
    marginTop: 16,
  },
  packDoneName: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  packDoneBody: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 26,
    fontStyle: 'italic',
    marginTop: 20,
  },
  packDoneSub: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  packDoneBtn: {
    marginTop: 32,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  packDoneBtnText: {
    fontFamily: FONT_BODY,
    fontSize: 16,
  },
  milestoneShareCardWrap: {
    width: 320,
    backgroundColor: DARK_CARD,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: SAGE,
    padding: 32,
    alignItems: 'center',
  },
  milestoneShareLogo: {
    width: 70,
    height: 70,
    alignSelf: 'center',
  },
  milestoneShareRibbonWrap: {
    marginTop: 8,
    alignItems: 'center',
  },
  milestoneShareHeading: {
    fontFamily: FONT_HEADING,
    color: SAGE,
    fontSize: 28,
    textAlign: 'center',
    marginTop: 12,
  },
  milestoneShareSubtext: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
  },
  milestoneShareBigNumber: {
    fontFamily: FONT_HEADING,
    color: SAGE,
    fontSize: 64,
    textAlign: 'center',
    marginTop: 8,
  },
  milestoneShareDaysLabel: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
  },
  vaultSavedBanner: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
  vaultButton: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: PURPLE,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  badgesHeader: {
    backgroundColor: BG,
  },
  badgesHeaderTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 28,
    textAlign: 'left',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  badgesHeaderSub: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 15,
    textAlign: 'left',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  badgesStatsBar: {
    backgroundColor: CARD_BG,
    margin: 16,
    padding: 12,
    borderRadius: 12,
  },
  badgesStatsText: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    textAlign: 'center',
    fontSize: 14,
  },
  badgesLoadingWrap: {
    padding: 24,
    alignItems: 'center',
  },
  badgesScrollContent: {
    paddingBottom: 32,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
  },
  badgeCell: {
    width: '50%',
    padding: 8,
  },
  badgeCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    position: 'relative',
  },
  badgeCardProOnlyMinimal: {
    justifyContent: 'center',
    gap: 10,
    minHeight: 120,
  },
  badgeProOnlyName: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.4,
  },
  badgeProOnlyPill: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 4,
  },
  badgeNameFreePending: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  badgeDescFreePending: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
    opacity: 0.85,
  },
  badgeCardEarned: {
    borderWidth: 2,
    borderColor: ORANGE,
  },
  badgeCardLocked: {
    borderWidth: 1,
    borderColor: BORDER,
  },
  badgeIconLocked: {
    opacity: 0.4,
  },
  badgeNameEarned: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  badgeNameLocked: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.4,
  },
  badgeDesc: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  badgeDescLocked: {
    opacity: 0.4,
  },
  badgeDate: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },
  badgeLockedLabel: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },
  proUpgradeCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 20,
    margin: 16,
  },
  proUpgradeTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 18,
    textAlign: 'center',
  },
  proUpgradeBody: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  proUpgradeBtn: {
    backgroundColor: CORAL_CTA,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 16,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  proUpgradeBtnText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  badgesProUpgradeCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 28,
    padding: 20,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
  },
  badgesProUpgradeTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 18,
    textAlign: 'center',
  },
  badgesProUpgradeBody: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  wrappedTeaserRoot: {
    flex: 1,
  },
  wrappedTeaserClose: {
    position: 'absolute',
    top: 8,
    right: 16,
    zIndex: 10,
  },
  wrappedTeaserContent: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 48,
  },
  wrappedTeaserLogo: {
    width: 100,
    height: 100,
    marginBottom: 24,
  },
  wrappedTeaserHeadline: {
    fontFamily: FONT_HEADING,
    color: TEXT_ON_DARK,
    fontSize: 32,
    textAlign: 'center',
  },
  wrappedTeaserSub: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 16,
    opacity: 0.7,
    lineHeight: 24,
  },
  wrappedTeaserBlursRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 8,
  },
  wrappedTeaserBlurCard: {
    width: 80,
    height: 120,
    margin: 8,
    borderRadius: 12,
    backgroundColor: CARD_BG,
    opacity: 0.5,
  },
  wrappedTeaserCta: {
    marginTop: 28,
    backgroundColor: CORAL_CTA,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    marginHorizontal: 8,
  },
  wrappedTeaserCtaText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
    textAlign: 'center',
  },
  badgeToastOuter: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    zIndex: 100,
  },
  badgeToastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
  },
  badgeToastText: {
    marginLeft: 12,
    flex: 1,
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
  },
  vaultScroll: {
    paddingBottom: 32,
  },
  vaultScrollEmpty: {
    flexGrow: 1,
    minHeight: Dimensions.get('window').height * 0.72,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  vaultHeaderTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 28,
    textAlign: 'left',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  vaultHeaderSub: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 15,
    textAlign: 'left',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  vaultStatsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: CARD_BG,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
  },
  vaultStatsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vaultStatsRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vaultStatsFire: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 13,
  },
  vaultStatsSince: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 13,
  },
  vaultLoadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vaultEmptyInner: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  vaultEmptyHeartIcon: {
    marginBottom: 12,
  },
  vaultEmptyTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 22,
    textAlign: 'center',
    padding: 24,
  },
  vaultEmptySub: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    textAlign: 'center',
    padding: 16,
    lineHeight: 22,
  },
  vaultEmptyBtn: {
    backgroundColor: SAGE,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  vaultEmptyBtnText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  vaultListWrap: {
    paddingHorizontal: 4,
    paddingBottom: 24,
  },
  vaultMomentCard: {
    position: 'relative',
    backgroundColor: CARD_BG,
    borderRadius: 16,
    margin: 12,
    padding: 20,
    paddingTop: 28,
  },
  vaultCardCornerIcon: {
    position: 'absolute',
    top: 12,
    right: 14,
  },
  vaultCardQuestion: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 14,
    fontStyle: 'italic',
    paddingRight: 28,
    marginBottom: 10,
  },
  vaultCardDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginBottom: 12,
  },
  vaultAnswersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  vaultAnswerCol: {
    flex: 1,
    minWidth: 120,
  },
  vaultYouLabel: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 12,
    marginBottom: 4,
  },
  vaultTheyLabel: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 12,
    marginBottom: 4,
  },
  vaultAnswerBody: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
  },
  vaultCardDate: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 11,
    opacity: 0.6,
    textAlign: 'right',
    marginTop: 14,
    alignSelf: 'stretch',
  },
  dbWrappedTeaser: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: `${ORANGE}44`,
  },
  dbWrappedTeaserTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 18,
    textAlign: 'center',
  },
  dbWrappedTeaserSub: {
    fontFamily: FONT_BODY,
    color: ORANGE,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  dbAddPartnerLinkWrap: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  dbAddPartnerLinkText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 12,
    opacity: 0.55,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  dbAccountLinksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 8,
    paddingBottom: 20,
  },
  dbSignOutLinkWrap: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  dbSignOutLinkText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 12,
    opacity: 0.5,
    textAlign: 'center',
  },
  dbAccountLinkSeparator: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 12,
    opacity: 0.5,
  },
  dbDeleteAccountLinkWrap: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  dbDeleteAccountLinkText: {
    fontFamily: FONT_BODY,
    color: '#ff6b6b',
    fontSize: 12,
    textAlign: 'center',
  },
  wrappedModalRoot: {
    flex: 1,
  },
  wrappedHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  wrappedHeaderSide: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrappedDotsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  wrappedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wrappedSavedToast: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  wrappedSavedToastText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 16,
  },
  wrappedLoading: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  wrappedCardInner: {
    overflow: 'hidden',
  },
  wrappedCoverWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  wrappedGlowTL: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.1,
  },
  wrappedGlowBR: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    opacity: 0.1,
  },
  wrappedCoverLogo: {
    width: 100,
    height: 100,
    marginTop: 80,
  },
  wrappedCoverYear: {
    fontSize: 18,
    opacity: 0.7,
    marginTop: 40,
    textAlign: 'center',
  },
  wrappedCoverTitle: {
    fontSize: 52,
    textAlign: 'center',
  },
  wrappedDividerOrange: {
    width: 60,
    height: 2,
    marginVertical: 24,
    alignSelf: 'center',
  },
  wrappedCoverTag: {
    fontSize: 14,
    opacity: 0.5,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  wrappedSwipeHint: {
    fontSize: 13,
    marginTop: 40,
    textAlign: 'center',
  },
  wrappedChevron: {
    marginTop: 4,
  },
  wrappedCardPad: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 56,
  },
  wrappedLabelPurple: {
    fontSize: 11,
    letterSpacing: 2,
    textAlign: 'center',
  },
  wrappedScoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: 8,
  },
  wrappedScoreBig: {
    fontSize: 96,
    lineHeight: 102,
  },
  wrappedScorePct: {
    fontSize: 48,
    marginBottom: 10,
    marginLeft: 2,
  },
  wrappedSyncSubtext: {
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  wrappedBodyCenter: {
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  wrappedAbsFooter: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  wrappedSaveBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 6,
  },
  wrappedMomentIntro: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
  },
  wrappedMomentQuestion: {
    fontSize: 22,
    fontStyle: 'italic',
    lineHeight: 30,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
  },
  wrappedAnswersRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 12,
  },
  wrappedAnsCardLeft: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    margin: 8,
    minHeight: 80,
    justifyContent: 'center',
  },
  wrappedAnsCardRight: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    margin: 8,
    minHeight: 80,
    justifyContent: 'center',
  },
  wrappedAnsTextLight: {
    fontSize: 13,
  },
  wrappedMomentFooter: {
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 16,
  },
  wrappedFlame: {
    fontSize: 48,
    textAlign: 'center',
    marginTop: 12,
  },
  wrappedStreakNum: {
    fontSize: 80,
    textAlign: 'center',
  },
  wrappedDaysLbl: {
    fontSize: 24,
    textAlign: 'center',
    marginTop: 4,
  },
  wrappedWhiteRule: {
    width: 60,
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.3,
    alignSelf: 'center',
    marginVertical: 24,
  },
  wrappedBodyCenterSmall: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  wrappedCategoryTitle: {
    fontSize: 48,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 12,
  },
  wrappedHumourIcon: {
    alignSelf: 'center',
    paddingTop: 100,
  },
  wrappedHumourStat: {
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 20,
  },
  wrappedHumourWitty: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 24,
  },
  wrappedWordIntro: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
  },
  wrappedWordBig: {
    fontSize: 64,
    textAlign: 'center',
    marginVertical: 24,
  },
  wrappedWordOutro: {
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 24,
  },
  wrappedEndLogo: {
    width: 60,
    height: 60,
    alignSelf: 'center',
    marginTop: 16,
  },
  packsHeaderTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 28,
    textAlign: 'left',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  packsHeaderSub: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  packsSectionLabel: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 11,
    letterSpacing: 2,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  packsSectionLabelCore: {
    fontFamily: FONT_BODY,
    color: PURPLE,
    fontSize: 11,
    letterSpacing: 2,
    paddingHorizontal: 24,
    marginTop: 24,
    paddingBottom: 8,
  },
  activePackCard: {
    marginHorizontal: 24,
    borderRadius: 18,
    padding: 18,
    minHeight: 158,
  },
  activePackTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activePackEmoji: {
    fontSize: 32,
  },
  activePackName: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 22,
    flex: 1,
  },
  activePackDayText: {
    fontFamily: FONT_BODY,
    color: `${TEXT}B3`,
    fontSize: 14,
    marginTop: 10,
  },
  activePackStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  activePackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
  },
  activePackStatusActive: {
    fontFamily: FONT_BODY,
    color: '#4ADE80',
    fontSize: 12,
  },
  activePackPausedText: {
    fontFamily: FONT_BODY,
    color: `${TEXT}99`,
    fontSize: 12,
    marginTop: 8,
  },
  activePackPauseBtn: {
    position: 'absolute',
    right: 14,
    bottom: 12,
  },
  activePackPauseBtnText: {
    fontFamily: FONT_BODY,
    color: `${TEXT}99`,
    fontSize: 13,
  },
  activePackResumeBtn: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  activePackResumeBtnText: {
    fontFamily: FONT_BODY,
    fontSize: 14,
  },
  packGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    rowGap: 8,
    marginBottom: 4,
  },
  packGridAfterActive: {
    marginTop: 24,
  },
  packCard: {
    borderRadius: 16,
    padding: 16,
    overflow: 'hidden',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  packCardContent: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  packCardEmoji: {
    fontSize: 24,
  },
  packCardName: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 8,
  },
  packCardDescription: {
    fontFamily: FONT_BODY,
    color: `${TEXT}A6`,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  packCardSpacer: {
    flex: 1,
  },
  packCardBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  packCardPrice: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 16,
  },
  packCardDuration: {
    fontFamily: FONT_BODY,
    color: `${TEXT}99`,
    fontSize: 11,
  },
  packOwnedBadge: {
    position: 'absolute',
    right: 10,
    top: 10,
    backgroundColor: `${PURPLE}1A`,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  packOwnedBadgeText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 10,
  },
  packActiveBadge: {
    backgroundColor: '#4ADE80',
  },
  packActiveBadgeText: {
    color: '#07211A',
  },
  packsLoadingWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  pauseOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  pauseCard: {
    backgroundColor: BG,
    borderRadius: 20,
    padding: 32,
  },
  pauseTitle: {
    fontFamily: FONT_HEADING,
    color: TEXT,
    fontSize: 22,
    textAlign: 'center',
  },
  pauseBody: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 12,
  },
  pauseConfirmBtn: {
    marginTop: 20,
    backgroundColor: PURPLE,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  pauseConfirmBtnText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 15,
  },
  pauseCancelBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 13,
    alignItems: 'center',
  },
  pauseCancelBtnText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 15,
  },
  packDetailRoot: {
    flex: 1,
  },
  packDetailClose: {
    position: 'absolute',
    right: 16,
    top: 56,
    zIndex: 10,
  },
  packDetailContent: {
    paddingHorizontal: 24,
    paddingBottom: 36,
    alignItems: 'center',
  },
  packDetailEmoji: {
    fontSize: 64,
    marginTop: 80,
  },
  packDetailName: {
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 36,
    textAlign: 'center',
    marginTop: 12,
  },
  packDetailTagline: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 12,
  },
  packDetailDuration: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  packDetailDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.2,
    marginVertical: 24,
  },
  packDetailDescription: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 24,
  },
  packDetailPrice: {
    fontFamily: FONT_HEADING,
    color: '#FFFFFF',
    fontSize: 48,
    textAlign: 'center',
    marginTop: 20,
  },
  packDetailPrimaryBtn: {
    marginTop: 20,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  packDetailPrimaryBtnDisabled: {
    opacity: 0.5,
  },
  packDetailPrimaryBtnText: {
    fontFamily: FONT_BODY,
    fontSize: 16,
  },
  packDetailDisabledBtn: {
    marginTop: 20,
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    opacity: 0.5,
  },
  packDetailDisabledBtnText: {
    fontFamily: FONT_BODY,
    color: '#FFFFFF',
    fontSize: 16,
  },
  packDetailDisabledHint: {
    fontFamily: FONT_BODY,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  packToastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
  },
  packToastInner: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 12,
    padding: 16,
  },
  packToastText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
  },
  wrappedEndUrl: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
  planPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  planPickerCard: {
    backgroundColor: BG,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  planPickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  planPickerRestoreText: {
    fontFamily: FONT_BODY,
    fontSize: 14,
    color: `${TEXT}66`,
  },
  planPickerDismissText: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: `${NAVY}66`,
    letterSpacing: 0.2,
  },
  planPickerMonthlyBtn: {
    backgroundColor: PURPLE,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  planPickerMonthlyBtnText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  planPickerAnnualBtn: {
    backgroundColor: SAGE,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  planPickerAnnualBtnText: {
    fontFamily: FONT_BODY,
    color: TEXT_ON_DARK,
    fontSize: 16,
  },
  purchaseToastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 26,
  },
  purchaseToastInner: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 14,
  },
  purchaseToastText: {
    fontFamily: FONT_BODY,
    color: TEXT,
    fontSize: 14,
    textAlign: 'center',
  },
});
