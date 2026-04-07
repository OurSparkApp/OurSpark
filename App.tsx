import { Montserrat_400Regular } from '@expo-google-fonts/montserrat';
import { RedHatDisplay_700Bold } from '@expo-google-fonts/red-hat-display';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const BG = '#090236';
const CREAM = '#F1E9D2';
const PURPLE = '#841C67';
const ORANGE = '#F4A147';
const CARD_BG = '#0D0845';

const FONT_HEADING = 'RedHatDisplay_700Bold';
const FONT_BODY = 'Montserrat_400Regular';

const Tab = createBottomTabNavigator();

function formatTodayLong(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function GradientButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.92} style={styles.ctaOuter} onPress={onPress}>
      <View style={styles.gradientLayerPurple} />
      <View style={styles.gradientLayerOrange} />
      <Text style={styles.ctaText}>{label}</Text>
    </TouchableOpacity>
  );
}

function HomeScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.homeInner}>
        <View style={styles.header}>
          <Text style={styles.logo}>OurSpark</Text>
          <Text style={styles.tagline}>Feel seen. Feel connected.</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.heart} allowFontScaling={false}>
            ❤️
          </Text>
        </View>
        <View style={styles.footer}>
          <GradientButton label="Begin Your Story" />
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

function MainTabs() {
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
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color }) => (
            <Text style={[styles.tabIcon, { color }]} allowFontScaling={false}>
              ⌂
            </Text>
          ),
        }}
      />
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

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    RedHatDisplay_700Bold,
    Montserrat_400Regular,
  });

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
        <MainTabs />
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
    fontSize: 22,
    color: `${CREAM}88`,
    letterSpacing: 2,
  },
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  homeInner: {
    flex: 1,
    paddingHorizontal: 28,
  },
  header: {
    alignItems: 'center',
    marginTop: 8,
  },
  logo: {
    fontFamily: FONT_HEADING,
    fontSize: 40,
    color: CREAM,
    letterSpacing: 1,
  },
  tagline: {
    fontFamily: FONT_BODY,
    fontSize: 16,
    color: CREAM,
    marginTop: 12,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    fontSize: 88,
    lineHeight: 100,
  },
  footer: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 8,
  },
  ctaOuter: {
    width: '100%',
    maxWidth: 340,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: ORANGE,
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
  ctaText: {
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
