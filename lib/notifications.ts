import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { scheduledDateMatchesTodayMonthDay } from './scheduledQuestion';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const DAILY_QUESTION_NOTIFICATION_ID = 'daily-question-8am';
const STREAK_REMINDER_NOTIFICATION_ID = 'streak-reminder-8pm';

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

async function fetchTodayAnswersRows(
  activeCoupleId: string,
  activeQuestionId: string
): Promise<Record<string, unknown>[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data } = await supabase
    .from('answers')
    .select('*')
    .eq('couple_id', activeCoupleId)
    .eq('question_id', activeQuestionId)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());

  return (data ?? []) as Record<string, unknown>[];
}

async function currentUserHasAnsweredToday(): Promise<boolean> {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) {
    return false;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('couple_id')
    .eq('id', uid)
    .maybeSingle();

  const coupleId = profile?.couple_id != null ? String(profile.couple_id) : null;
  if (!coupleId) {
    return false;
  }

  const qRow = await resolveTodayQuestionRow();
  const qId = qRow?.id != null ? String(qRow.id) : null;
  if (!qId) {
    return false;
  }

  const rows = await fetchTodayAnswersRows(coupleId, qId);
  return rows.some((r) => String(r.user_id ?? '') === uid);
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    return null;
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync();

  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (uid) {
    await supabase.from('profiles').update({ push_token: tokenResult.data }).eq('id', uid);
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#841C67',
    });
  }

  return tokenResult.data;
}

export async function scheduleQuestionNotification(): Promise<string | null> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  return Notifications.scheduleNotificationAsync({
    identifier: DAILY_QUESTION_NOTIFICATION_ID,
    content: {
      title: 'Your daily question is ready',
      body: 'Take 30 seconds to answer. Your partner is waiting.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
    },
  });
}

export async function sendRevealNotification(): Promise<string | null> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Your partner just answered!',
      body: 'The reveal is ready. See what they said.',
    },
    trigger: null,
  });
}

export async function sendStreakReminderNotification(): Promise<string | null> {
  await Notifications.cancelScheduledNotificationAsync(STREAK_REMINDER_NOTIFICATION_ID);

  if (await currentUserHasAnsweredToday()) {
    return null;
  }

  return Notifications.scheduleNotificationAsync({
    identifier: STREAK_REMINDER_NOTIFICATION_ID,
    content: {
      title: "Don't lose your streak",
      body: "You haven't answered today's question yet. Keep your spark alive.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 20,
      minute: 0,
    },
  });
}
