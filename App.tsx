import { Montserrat_400Regular } from '@expo-google-fonts/montserrat';
import { RedHatDisplay_700Bold } from '@expo-google-fonts/red-hat-display';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import {
  NavigationContainer,
  createNavigationContainerRef,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import ViewShot from 'react-native-view-shot';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import {
  registerForPushNotifications,
  scheduleQuestionNotification,
  sendRevealNotification,
} from './lib/notifications';
// DB migration for Expo push tokens (run in Supabase SQL editor):
// -- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token text;
import { scheduledDateMatchesTodayMonthDay } from './lib/scheduledQuestion';
import { supabase } from './lib/supabase';

type MainTabParamList = {
  Dashboard: undefined;
  Question: undefined;
  Vault: undefined;
};

const navigationRef = createNavigationContainerRef<MainTabParamList>();

const BG = '#090236';
const CREAM = '#F1E9D2';
const PURPLE = '#841C67';
const ORANGE = '#F4A147';
const CARD_BG = '#0D0845';

const FONT_HEADING = 'RedHatDisplay_700Bold';
const FONT_BODY = 'Montserrat_400Regular';
const HOME_LOGO = require('./assets/OurSpark_Logo_White_font_for_dark_background.png');

const Tab = createBottomTabNavigator();
type AppStage = 'marketing' | 'auth' | 'personalization' | 'invite' | 'main';

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

async function resolveTodayQuestionRow(): Promise<Record<string, unknown> | null> {
  const today = new Date();

  const { data: allQuestions, error: allQuestionsError } = await supabase.from('questions').select('*');

  if (allQuestionsError || !allQuestions || allQuestions.length === 0) {
    return null;
  }

  const scheduledMatch = allQuestions.find((row) => {
    const rowMap = row as Record<string, unknown>;
    if (rowMap.scheduled_date == null) {
      return false;
    }
    if (!scheduledDateMatchesTodayMonthDay(rowMap.scheduled_date, today)) {
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

  const questionIndex = getDayOfYear(today) % validQuestions.length;
  return validQuestions[questionIndex].row;
}

function getLocalDayBounds(): { startIso: string; endIso: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Today's answers for this couple + question (local calendar day). Prefers submitted_at; falls back to created_at. */
async function fetchTodayAnswersRows(
  activeCoupleId: string,
  activeQuestionId: string
): Promise<Record<string, unknown>[]> {
  const { startIso, endIso } = getLocalDayBounds();

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

function formatTodayLong(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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

function tokenizeAnswerForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['']+|['']+$/g, ''))
    .filter((w) => w.length > 0 && !ANSWER_MATCH_STOP_WORDS.has(w));
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
  if (matchWordCount >= 3) {
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
    labelColor: CREAM,
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
          <Text style={styles.tagline}>{"There's still a spark. Let's make it ours."}</Text>
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

function DashboardScreen({ userId }: { userId: string }) {
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  const [firstName, setFirstName] = useState('');
  const [dateLine, setDateLine] = useState('');
  const [currentStreak, setCurrentStreak] = useState(0);
  const [compatibilityScore, setCompatibilityScore] = useState(0);
  const [vaultCount, setVaultCount] = useState(0);
  const [todayStatus, setTodayStatus] = useState<DailyQuestionStatus>('not_answered');
  const didRegisterPushNotifications = useRef(false);

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

  const loadDashboardData = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? userId;

    setDateLine(formatTodayLong(new Date()));

    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, couple_id')
      .eq('id', uid)
      .maybeSingle();

    const name =
      typeof profile?.first_name === 'string' && profile.first_name.trim()
        ? profile.first_name.trim()
        : 'there';
    setFirstName(name);

    const coupleId = profile?.couple_id ? String(profile.couple_id) : null;

    if (!coupleId) {
      setCurrentStreak(0);
      setCompatibilityScore(0);
      setVaultCount(0);
      setTodayStatus('not_answered');
      return;
    }

    const { data: couple } = await supabase
      .from('couples')
      .select('current_streak, compatibility_score')
      .eq('id', coupleId)
      .maybeSingle();

    setCurrentStreak(Number(couple?.current_streak ?? 0));
    setCompatibilityScore(Number(couple?.compatibility_score ?? 0));

    const { count: vaultCountResult, error: vaultError } = await supabase
      .from('vault')
      .select('*', { count: 'exact', head: true })
      .eq('couple_id', coupleId);

    if (!vaultError) {
      setVaultCount(vaultCountResult ?? 0);
    } else {
      setVaultCount(0);
    }

    const qRow = await resolveTodayQuestionRow();
    const qId = qRow?.id != null ? String(qRow.id) : null;
    if (!qId) {
      setTodayStatus('not_answered');
      return;
    }

    const rows = await fetchTodayAnswersRows(coupleId, qId);
    const mine = rows.find((r) => String(r.user_id ?? '') === uid);
    const partner = rows.find((r) => String(r.user_id ?? '') !== uid);

    if (mine && partner) {
      setTodayStatus('reveal_ready');
    } else if (mine) {
      setTodayStatus('waiting');
    } else {
      setTodayStatus('not_answered');
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
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

  const greeting = `${getGreetingPrefix(new Date())}, ${firstName}`;

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
                <Ionicons name="chatbubble-outline" size={20} color={CREAM} />
                <Text style={styles.dbTodayTitle}>Your question is waiting...</Text>
              </View>
              <TouchableOpacity activeOpacity={0.92} style={styles.dbAnswerNowBtn} onPress={goToToday}>
                <Text style={styles.dbAnswerNowText}>Answer Now</Text>
              </TouchableOpacity>
            </>
          ) : null}
          {todayStatus === 'waiting' ? (
            <>
              <View style={styles.dbTitleIconRowTight}>
                <Ionicons name="lock-closed-outline" size={20} color={ORANGE} />
                <Text style={styles.dbTodayTitleLocked}>Answer locked in!</Text>
              </View>
              <Text style={styles.dbWaitingSub}>Waiting for your partner...</Text>
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
              <TouchableOpacity activeOpacity={0.92} style={styles.dbSeeRevealBtn} onPress={goToToday}>
                <Text style={styles.dbSeeRevealText}>See The Reveal</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

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

        <TouchableOpacity activeOpacity={0.9} style={styles.dbVaultCard} onPress={() => {}}>
          <View style={styles.dbVaultTitleRow}>
            <Ionicons name="heart-outline" size={22} color={CREAM} />
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
      </ScrollView>
    </SafeAreaView>
  );
}

type DailyState = 'answer' | 'waiting' | 'reveal';

function DailyQuestionScreen({ userId }: { userId: string }) {
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
  const [partnerName, setPartnerName] = useState<string>('Your partner');
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

  useEffect(() => {
    partnerNameRef.current = partnerName;
  }, [partnerName]);

  const answerMatchMeta = useMemo(
    () => getAnswerMatchMeta(myAnswer, partnerAnswer),
    [myAnswer, partnerAnswer]
  );

  const formatLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

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

  const updateCoupleStatsAfterReveal = async (myText: string, theirText: string) => {
    if (!coupleId) {
      return;
    }

    const { data: couple, error } = await supabase
      .from('couples')
      .select(
        'current_streak,longest_streak,last_answered_date,total_questions_answered,total_matches,compatibility_score'
      )
      .eq('id', coupleId)
      .maybeSingle();

    if (error || !couple) {
      return;
    }

    const todayKey = formatLocalDateKey(new Date());
    if (String(couple.last_answered_date ?? '') === todayKey) {
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = formatLocalDateKey(yesterday);

    const priorStreak = Number(couple.current_streak ?? 0);
    const nextStreak = String(couple.last_answered_date ?? '') === yesterdayKey ? priorStreak + 1 : 1;
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
      .eq('id', coupleId);

    if (updateError) {
      return;
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
    const getDayOfYear = (date: Date): number => {
      const start = new Date(date.getFullYear(), 0, 0);
      const diff = date.getTime() - start.getTime();
      return Math.floor(diff / 86400000);
    };

    const readQuestionText = (questionRow: Record<string, unknown>): string | null => {
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
    };

    const selectTodaysQuestion = async (): Promise<Record<string, unknown> | null> => {
      const today = new Date();

      const { data: allQuestions, error: allQuestionsError } = await supabase
        .from('questions')
        .select('*');

      if (allQuestionsError || !allQuestions || allQuestions.length === 0) {
        return null;
      }

      const scheduledMatch = allQuestions.find((row) => {
        const rowMap = row as Record<string, unknown>;
        if (rowMap.scheduled_date == null) {
          return false;
        }
        if (!scheduledDateMatchesTodayMonthDay(rowMap.scheduled_date, today)) {
          return false;
        }
        return Boolean(readQuestionText(rowMap));
      });

      if (scheduledMatch) {
        const scheduledText = readQuestionText(scheduledMatch as Record<string, unknown>);
        if (scheduledText) {
          setDailyQuestion(scheduledText);
          return scheduledMatch as Record<string, unknown>;
        }
      }

      const validQuestions = allQuestions
        .map((row) => {
          const rowMap = row as Record<string, unknown>;
          return { row: rowMap, text: readQuestionText(rowMap) };
        })
        .filter((item): item is { row: Record<string, unknown>; text: string } => Boolean(item.text));

      if (validQuestions.length === 0) {
        return null;
      }

      const dayOfYear = getDayOfYear(today);
      const totalQuestions = validQuestions.length;
      const questionIndex = Math.abs(dayOfYear % totalQuestions);
      setDailyQuestion(validQuestions[questionIndex].text);
      return validQuestions[questionIndex].row;
    };

    const loadQuestion = async () => {
      setDailyLoadReady(false);
      setCoupleId(null);
      setQuestionId(null);
      setDailyQuestion('');

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('couple_id, name')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        console.log('Profile loaded:', JSON.stringify(profile ?? null));
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

      const selectedQuestion = await selectTodaysQuestion();
      console.log('Question loaded:', JSON.stringify(selectedQuestion));

      const selectedQuestionId = selectedQuestion?.id;
      if (!selectedQuestionId) {
        setQuestionId(null);
        setDailyLoadReady(true);
        return;
      }

      const normalizedQuestionId = String(selectedQuestionId);
      const normalizedCoupleId = cid;
      setQuestionId(normalizedQuestionId);

      const { startIso, endIso } = getLocalDayBounds();

      const fetchMineToday = async (column: 'submitted_at' | 'created_at') => {
        const { data, error } = await supabase
          .from('answers')
          .select('*')
          .eq('user_id', userId)
          .eq('question_id', normalizedQuestionId)
          .eq('couple_id', normalizedCoupleId)
          .gte(column, startIso)
          .lt(column, endIso)
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) {
          return null;
        }
        const row = data?.[0] as Record<string, unknown> | undefined;
        return row ?? null;
      };

      let mineRow = await fetchMineToday('submitted_at');
      if (!mineRow) {
        mineRow = await fetchMineToday('created_at');
      }

      if (!mineRow) {
        setMyAnswer('');
        setPartnerAnswer('');
        setDailyState('answer');
        setDailyLoadReady(true);
        return;
      }

      setMyAnswer(readAnswerText(mineRow));

      const fetchPartnerToday = async (column: 'submitted_at' | 'created_at') => {
        const { data, error } = await supabase
          .from('answers')
          .select('*')
          .eq('couple_id', normalizedCoupleId)
          .eq('question_id', normalizedQuestionId)
          .neq('user_id', userId)
          .gte(column, startIso)
          .lt(column, endIso)
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) {
          return null;
        }
        const row = data?.[0] as Record<string, unknown> | undefined;
        return row ?? null;
      };

      let partnerRow = await fetchPartnerToday('submitted_at');
      if (!partnerRow) {
        partnerRow = await fetchPartnerToday('created_at');
      }

      if (partnerRow) {
        setPartnerAnswer(readAnswerText(partnerRow));
        setDailyState('reveal');
        await updateCoupleStatsAfterReveal(readAnswerText(mineRow), readAnswerText(partnerRow));
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
      setPartnerName('Your partner');
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data: partnerProfile, error } = await supabase
        .from('profiles')
        .select('name')
        .eq('couple_id', coupleId)
        .neq('id', userId)
        .single();

      if (cancelled) {
        return;
      }

      if (error) {
        const fallback = 'Your partner';
        console.log('Partner name:', fallback);
        setPartnerName(fallback);
        return;
      }

      const nextPartnerName = partnerProfile?.name || 'Your partner';
      const resolved =
        typeof nextPartnerName === 'string' && nextPartnerName.trim().length > 0
          ? nextPartnerName.trim()
          : 'Your partner';

      console.log('Partner name:', resolved);
      setPartnerName(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [coupleId, userId]);

  const waitingMessage = useMemo(
    () => `Waiting for ${partnerName}'s answer...`,
    [partnerName]
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
    const answerText = answer;
    const currentQuestion = questionId ? { id: questionId } : null;

    console.log('Submit answer tapped');
    console.log('Answer text:', answerText);
    console.log('Question ID:', currentQuestion?.id);
    console.log('Couple ID:', coupleId);
    console.log('User ID:', userId);

    if (!coupleId || !questionId || !answer.trim()) {
      return;
    }

    setIsSubmitting(true);
    // Persist submission time; add `submitted_at timestamptz` to `answers` if the insert fails.
    const payload = {
      couple_id: coupleId,
      question_id: questionId,
      user_id: userId,
      answer_text: answer.trim(),
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('answers').insert(payload);
    console.log('Insert result:', JSON.stringify(data), JSON.stringify(error));
    setIsSubmitting(false);

    if (error) {
      return;
    }

    setMyAnswer(answer.trim());
    setDailyState('waiting');
  };

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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
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
          <Text style={styles.todayLabel}>{"TODAY'S QUESTION"}</Text>
          <Text style={styles.dateAccent}>{todayLabel}</Text>

          <View style={styles.questionCard}>
            <Text style={styles.questionText}>
              {needsAccountSetup ? 'Setting up your account...' : dailyQuestion}
            </Text>
          </View>

          {dailyLoadReady && canSubmitAnswer && dailyState === 'answer' ? (
            <>
              <TextInput
                style={styles.answerInput}
                placeholder="Type your answer here... be honest"
                placeholderTextColor={`${CREAM}99`}
                value={answer}
                onChangeText={setAnswer}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.inviteActionButton}
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
                <Ionicons name="sparkles-outline" size={24} color={ORANGE} />
                <Text style={styles.revealHeading}>Today&apos;s Reveal</Text>
              </View>
              <View style={styles.revealCard}>
                <Text style={styles.revealYouLabel}>You said:</Text>
                <Text style={styles.revealBodyText}>{myAnswer}</Text>
              </View>
              <View style={styles.revealCard}>
                <Text style={styles.revealPartnerLabel}>
                  {partnerName ? `${partnerName} said:` : 'They said:'}
                </Text>
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
          <View style={styles.shareModalCenterColumn}>
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
                  {"There's still a spark. Let's make it ours."}
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
              <Text style={styles.shareModalContinueText}>Continue</Text>
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
                <Ionicons name="ribbon-outline" size={70} color="#F4A147" />
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
                {"There's still a spark. Let's make it ours."}
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

function InviteCodeScreen({ userId, onComplete }: { userId: string; onComplete: () => void }) {
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isWorking, setIsWorking] = useState(false);

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
        onComplete();
        return;
      }

      setIsLoadingProfile(false);
    };

    checkExistingCouple();

    return () => {
      isActive = false;
    };
  }, [onComplete, userId]);

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

  const shareInviteCode = async () => {
    if (!inviteCode) {
      return;
    }

    await Share.share({
      message: `I'm using OurSpark to connect with you every day. Download the app and use my code ${inviteCode} to join me.

Download here: https://ourspark.app (coming soon)

One question a day. Answered together.`,
    });
  };

  if (isLoadingProfile) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loadingRoot}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
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
              <TouchableOpacity activeOpacity={0.85} style={styles.generatedCodeButton} onPress={shareInviteCode}>
                <Text style={styles.generatedCodeText}>{inviteCode}</Text>
              </TouchableOpacity>
              <Text style={styles.generatedCodeTapHint}>Tap to share</Text>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.inviteActionButton}
                onPress={onComplete}
                disabled={isWorking}
              >
                <Text style={styles.inviteActionButtonText}>Continue</Text>
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
            placeholderTextColor={`${CREAM}99`}
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
    </SafeAreaView>
  );
}

function AuthScreen({
  mode,
  onSubmit,
  onSwitchMode,
}: {
  mode: AuthMode;
  onSubmit: (payload: {
    mode: AuthMode;
    firstName: string;
    email: string;
    password: string;
  }) => Promise<string | null>;
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
              placeholderTextColor={`${CREAM}99`}
              value={firstName}
              onChangeText={setFirstName}
            />
          )}

          <TextInput
            style={styles.authInput}
            placeholder="Email"
            placeholderTextColor={`${CREAM}99`}
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
              placeholderTextColor="#F1E9D233"
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
                color="#F1E9D2"
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

function VaultScreen({ userId }: { userId: string }) {
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const [loading, setLoading] = useState(true);
  const [moments, setMoments] = useState<VaultMomentDisplay[]>([]);
  const [firstVaultDateLabel, setFirstVaultDateLabel] = useState('');

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
      setLoading(false);
      return;
    }

    const coupleId = String(profile.couple_id);

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

    const questionIds = [
      ...new Set(
        vaultRows
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

    const built: VaultMomentDisplay[] = vaultRows.map((row) => {
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
        questionText: questionTextById.get(qid) ?? '—',
        youSaid: readAnswerTextFromRow(mine ?? {}),
        theySaid: readAnswerTextFromRow(partner ?? {}),
        savedAtLabel,
      };
    });

    const oldest = [...vaultRows].sort((a, b) => {
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
              <Ionicons name="calendar-outline" size={16} color={CREAM} />
              <Text style={styles.vaultStatsSince}>Since {firstVaultDateLabel || '—'}</Text>
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
            <Ionicons name="heart-outline" size={60} color={CREAM} style={styles.vaultEmptyHeartIcon} />
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
                    <Text style={styles.vaultAnswerBody}>{m.youSaid || '—'}</Text>
                  </View>
                  <View style={styles.vaultAnswerCol}>
                    <Text style={styles.vaultTheyLabel}>They said:</Text>
                    <Text style={styles.vaultAnswerBody}>{m.theySaid || '—'}</Text>
                  </View>
                </View>
                <Text style={styles.vaultCardDate}>{m.savedAtLabel}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MainTabs({ userId }: { userId: string }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: CARD_BG,
          borderTopColor: `${PURPLE}55`,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 6,
          height: Platform.OS === 'ios' ? 88 : 64,
        },
        tabBarLabelStyle: {
          fontFamily: FONT_BODY,
          fontSize: 12,
          letterSpacing: 0.3,
        },
        tabBarActiveTintColor: ORANGE,
        tabBarInactiveTintColor: `${CREAM}99`,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={24} color={color} />,
        }}
      >
        {() => <DashboardScreen userId={userId} />}
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
        name="Vault"
        options={{
          tabBarLabel: 'Vault',
          tabBarIcon: ({ color }) => <Ionicons name="heart-outline" size={24} color={color} />,
        }}
      >
        {() => <VaultScreen userId={userId} />}
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
    const payload = {
      anniversary_day: toNullableNumber(anniversaryDay),
      anniversary_month: toNullableNumber(anniversaryMonth),
      birthday_day: toNullableNumber(birthdayDay),
      birthday_month: toNullableNumber(birthdayMonth),
      partner_birthday_day: toNullableNumber(partnerBirthdayDay),
      partner_birthday_month: toNullableNumber(partnerBirthdayMonth),
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
                placeholderTextColor={`${CREAM}99`}
                value={anniversaryDay}
                onChangeText={setAnniversaryDay}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.dateInput}
                placeholder="Month"
                placeholderTextColor={`${CREAM}99`}
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
                placeholderTextColor={`${CREAM}99`}
                value={birthdayDay}
                onChangeText={setBirthdayDay}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.dateInput}
                placeholder="Month"
                placeholderTextColor={`${CREAM}99`}
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
                placeholderTextColor={`${CREAM}99`}
                value={partnerBirthdayDay}
                onChangeText={setPartnerBirthdayDay}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.dateInput}
                placeholder="Month"
                placeholderTextColor={`${CREAM}99`}
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
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const appStageRef = useRef(appStage);
  const pendingNavigateToQuestionRef = useRef(false);

  appStageRef.current = appStage;

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
          <MainTabs userId={currentUserId ?? ''} />
        ) : appStage === 'personalization' && currentUserId ? (
          <PersonalizationScreen
            userId={currentUserId}
            onContinue={() => setAppStage('invite')}
            onSkip={() => setAppStage('invite')}
          />
        ) : appStage === 'invite' && currentUserId ? (
          <InviteCodeScreen userId={currentUserId} onComplete={() => setAppStage('main')} />
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
            onSwitchMode={() => setAuthMode((prev) => (prev === 'login' ? 'signup' : 'login'))}
          />
        )}
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
    color: `${CREAM}88`,
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
    color: CREAM,
    textAlign: 'center',
    marginBottom: 26,
  },
  authInput: {
    backgroundColor: CARD_BG,
    borderColor: PURPLE,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: CREAM,
    fontFamily: FONT_BODY,
    fontSize: 15,
    marginBottom: 12,
  },
  authPasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0845',
    borderWidth: 1,
    borderColor: '#841C67',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  authPasswordInput: {
    flex: 1,
    color: '#F1E9D2',
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
    color: CREAM,
  },
  authButtonOuter: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F48F4F',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#F48F4F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  authButtonText: {
    fontFamily: FONT_BODY,
    fontSize: 17,
    color: CREAM,
    letterSpacing: 0.3,
  },
  authSwitchText: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    color: CREAM,
    fontSize: 32,
    textAlign: 'center',
    marginBottom: 10,
  },
  personalizationSubheading: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    color: CREAM,
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
    borderColor: PURPLE,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: CREAM,
    fontFamily: FONT_BODY,
    fontSize: 15,
    textAlign: 'center',
  },
  personalizationButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F48F4F',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#F48F4F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  personalizationButtonText: {
    fontFamily: FONT_BODY,
    fontSize: 17,
    color: CREAM,
    letterSpacing: 0.3,
  },
  personalizationSkip: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    color: CREAM,
    textAlign: 'center',
    marginBottom: 10,
  },
  inviteSubheading: {
    fontFamily: FONT_BODY,
    fontSize: 15,
    color: CREAM,
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
    color: CREAM,
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
    color: CREAM,
    marginTop: 8,
    marginBottom: 12,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: `${CREAM}33`,
  },
  orText: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    color: CREAM,
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
    margin: 16,
    padding: 20,
  },
  dbTodayCardGlow: {
    borderWidth: 2,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
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
    color: CREAM,
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
    color: CREAM,
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
    backgroundColor: '#F48F4F',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dbAnswerNowText: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    color: CREAM,
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
    color: CREAM,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  dbStatEmptyText: {
    fontFamily: FONT_BODY,
    color: CREAM,
    fontSize: 12,
    textAlign: 'center',
  },
  dbVaultCard: {
    backgroundColor: CARD_BG,
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
    color: CREAM,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 0,
  },
  dbStatIconTop: {
    marginBottom: 8,
  },
  dbVaultSub: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    color: CREAM,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  homeCtaButton: {
    width: '100%',
    maxWidth: 340,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F48F4F',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F48F4F',
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
    color: CREAM,
    letterSpacing: 0.4,
  },
  caption: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: CREAM,
    opacity: 0.85,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  dailyScroll: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 12,
  },
  todayLabel: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: CREAM,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${PURPLE}44`,
  },
  questionText: {
    fontFamily: FONT_BODY,
    fontSize: 18,
    lineHeight: 28,
    color: CREAM,
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
    borderColor: `${CREAM}33`,
    fontFamily: FONT_BODY,
    fontSize: 16,
    lineHeight: 22,
    color: CREAM,
  },
  waitingWrap: {
    marginTop: 18,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${PURPLE}55`,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  waitingText: {
    fontFamily: FONT_BODY,
    color: CREAM,
    fontSize: 15,
    textAlign: 'center',
  },
  revealWrap: {
    marginTop: 20,
    gap: 12,
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
    color: ORANGE,
    fontSize: 28,
    textAlign: 'center',
    marginBottom: 0,
  },
  revealCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${PURPLE}55`,
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
    color: CREAM,
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
  perfectSyncCardWrap: {
    width: 320,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#F4A147',
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
    backgroundColor: '#090236',
  },
  perfectSyncGradientBottom: {
    flex: 1,
    backgroundColor: '#0D0845',
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
    backgroundColor: '#F4A147',
  },
  perfectSyncTitle: {
    fontFamily: FONT_HEADING,
    color: '#F4A147',
    fontSize: 32,
    textAlign: 'center',
    marginTop: 12,
  },
  perfectSyncSubtitle: {
    fontFamily: FONT_BODY,
    color: '#F1E9D2',
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
    color: '#F1E9D2',
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
    backgroundColor: '#F48F4F',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  shareModalPrimaryButtonText: {
    fontFamily: FONT_BODY,
    color: CREAM,
    fontSize: 16,
  },
  shareModalContinueWrap: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  shareModalContinueText: {
    fontFamily: FONT_BODY,
    color: '#F1E9D2',
    fontSize: 15,
    textAlign: 'center',
  },
  milestoneShareCardWrap: {
    width: 320,
    backgroundColor: '#0D0845',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#F4A147',
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
    color: '#F4A147',
    fontSize: 28,
    textAlign: 'center',
    marginTop: 12,
  },
  milestoneShareSubtext: {
    fontFamily: FONT_BODY,
    color: '#F1E9D2',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
  },
  milestoneShareBigNumber: {
    fontFamily: FONT_HEADING,
    color: '#F4A147',
    fontSize: 64,
    textAlign: 'center',
    marginTop: 8,
  },
  milestoneShareDaysLabel: {
    fontFamily: FONT_BODY,
    color: '#F1E9D2',
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
    color: CREAM,
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
    color: CREAM,
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
    color: CREAM,
    fontSize: 22,
    textAlign: 'center',
    padding: 24,
  },
  vaultEmptySub: {
    fontFamily: FONT_BODY,
    color: CREAM,
    fontSize: 15,
    textAlign: 'center',
    padding: 16,
    lineHeight: 22,
  },
  vaultEmptyBtn: {
    backgroundColor: '#F48F4F',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  vaultEmptyBtnText: {
    fontFamily: FONT_BODY,
    color: CREAM,
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
    backgroundColor: `${PURPLE}4D`,
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
    color: CREAM,
    fontSize: 15,
    lineHeight: 22,
  },
  vaultCardDate: {
    fontFamily: FONT_BODY,
    color: CREAM,
    fontSize: 11,
    opacity: 0.6,
    textAlign: 'right',
    marginTop: 14,
    alignSelf: 'stretch',
  },
});
