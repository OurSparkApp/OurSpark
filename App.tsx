import { Montserrat_400Regular } from '@expo-google-fonts/montserrat';
import { RedHatDisplay_700Bold } from '@expo-google-fonts/red-hat-display';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
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
import { supabase } from './lib/supabase';

const BG = '#090236';
const CREAM = '#F1E9D2';
const PURPLE = '#841C67';
const ORANGE = '#F4A147';
const CARD_BG = '#0D0845';

const FONT_HEADING = 'RedHatDisplay_700Bold';
const FONT_BODY = 'Montserrat_400Regular';
const HOME_LOGO = require('./assets/OurSpark_Logo_White_font_for_dark_background.png');

const Tab = createBottomTabNavigator();
type AppStage = 'auth' | 'invite' | 'main';

function formatTodayLong(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function HomeButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.92} style={styles.homeCtaButton} onPress={onPress}>
      <Text style={styles.homeCtaText}>{label}</Text>
    </TouchableOpacity>
  );
}

function HomeScreen({ onBeginOurStory }: { onBeginOurStory?: () => void }) {
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
        </View>
      </View>
    </SafeAreaView>
  );
}

function DailyQuestionScreen() {
  const [answer, setAnswer] = useState('');
  const todayLabel = useMemo(() => formatTodayLong(new Date()), []);

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
              {"What's one small thing your partner does that makes you feel loved?"}
            </Text>
          </View>

          <TextInput
            style={styles.answerInput}
            placeholder="Type your answer here... be honest 💭"
            placeholderTextColor={`${CREAM}99`}
            value={answer}
            onChangeText={setAnswer}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
      message: `💕 I'm using OurSpark to connect with you every day. Download the app and use my code ${inviteCode} to join me! 

Download here: https://ourspark.app (coming soon)

One question a day. Answered together. 🔥`,
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

function MainTabs({ onBeginOurStory }: { onBeginOurStory: () => void }) {
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
        name="Home"
        options={{
          tabBarIcon: ({ color }) => (
            <Text style={[styles.tabIcon, { color }]} allowFontScaling={false}>
              ⌂
            </Text>
          ),
        }}
      >
        {() => <HomeScreen onBeginOurStory={onBeginOurStory} />}
      </Tab.Screen>
      <Tab.Screen
        name="Question"
        component={DailyQuestionScreen}
        options={{
          tabBarLabel: 'Today',
          tabBarIcon: ({ color }) => (
            <Text style={[styles.tabIcon, { color }]} allowFontScaling={false}>
              ✦
            </Text>
          ),
        }}
      />
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

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    RedHatDisplay_700Bold,
    Montserrat_400Regular,
  });
  const [appStage, setAppStage] = useState<AppStage>('auth');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  if (!fontsLoaded && !fontError) {
    return <LoadingScreen />;
  }

  if (fontError) {
    console.warn(fontError);
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        {appStage === 'main' ? (
          <MainTabs
            onBeginOurStory={async () => {
              await supabase.auth.signOut();
              setCurrentUserId(null);
              setAuthMode('signup');
              setAppStage('auth');
            }}
          />
        ) : appStage === 'invite' && currentUserId ? (
          <InviteCodeScreen userId={currentUserId} onComplete={() => setAppStage('main')} />
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
                  setAppStage('invite');
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
  tabIcon: {
    fontSize: 20,
    marginBottom: -2,
  },
});
