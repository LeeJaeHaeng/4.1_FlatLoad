import React, { useState } from 'react';
import {
  NavigationContainer,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from './context/AuthContext';

import MapScreen from './screens/MapScreen';
import CommunityScreen from './screens/CommunityScreen';
import ContributeScreen from './screens/ContributeScreen';
import NotificationScreen from './screens/NotificationScreen';
import MyPageScreen from './screens/MyPageScreen';

const Tab = createBottomTabNavigator();

const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#AAAAAA';

type TabIconName = 'place' | 'group' | 'add-location-alt' | 'notifications' | 'person';

function TabIcon({
  name,
  focused,
  label,
}: {
  name: TabIconName;
  focused: boolean;
  label: string;
}) {
  return (
    <View style={tabStyles.wrapper}>
      {focused && <View style={tabStyles.indicator} />}
      <MaterialIcons
        name={name}
        size={23}
        color={focused ? ACTIVE_COLOR : INACTIVE_COLOR}
      />
      <Text style={[tabStyles.label, { color: focused ? ACTIVE_COLOR : INACTIVE_COLOR }]}>
        {label}
      </Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 0,
    gap: 3,
    width: 64,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: ACTIVE_COLOR,
  },
});

function NicknameModal({ onRegister }: { onRegister: (name: string) => Promise<void> }) {
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    setSubmitting(true);
    await onRegister(trimmed);
    setSubmitting(false);
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <KeyboardAvoidingView
        style={nicknameStyles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={nicknameStyles.card}>
          <Text style={nicknameStyles.appTitle}>FlatRoad</Text>
          <Text style={nicknameStyles.appSubtitle}>보행 약자를 위한 장애물 지도</Text>

          <View style={nicknameStyles.divider} />

          <Text style={nicknameStyles.promptTitle}>닉네임을 입력해주세요</Text>
          <Text style={nicknameStyles.promptDesc}>
            서비스 이용 시 표시되는 이름입니다 (최대 12자)
          </Text>

          <TextInput
            style={nicknameStyles.input}
            placeholder="닉네임 입력"
            placeholderTextColor="#BBBBBB"
            value={nickname}
            onChangeText={setNickname}
            maxLength={12}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            autoFocus
          />

          <TouchableOpacity
            style={[
              nicknameStyles.button,
              !nickname.trim() && nicknameStyles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!nickname.trim() || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={nicknameStyles.buttonText}>시작하기</Text>
            )}
          </TouchableOpacity>

          {/* TODO: 정식 버전에서 Google 로그인으로 교체 예정 */}
          <Text style={nicknameStyles.futureNote}>
            정식 버전에서는 Google 로그인이 지원됩니다
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const nicknameStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F5A623',
    letterSpacing: 1,
  },
  appSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#F0F0F0',
    marginVertical: 20,
  },
  promptTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#222',
    marginBottom: 6,
  },
  promptDesc: {
    fontSize: 13,
    color: '#888',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#222',
    marginBottom: 16,
    backgroundColor: '#FAFAFA',
  },
  button: {
    width: '100%',
    height: 48,
    backgroundColor: '#F5A623',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    backgroundColor: '#DDDDDD',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  futureNote: {
    fontSize: 12,
    color: '#BBBBBB',
  },
});

function AppContent() {
  const { user, loading, registerUser } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    );
  }

  return (
    <>
      {!user && <NicknameModal onRegister={registerUser} />}
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarStyle: {
              borderTopWidth: 1,
              borderTopColor: '#EBEBEB',
              backgroundColor: '#fff',
              elevation: 10,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
              height: 62,
              paddingBottom: 6,
            },
            tabBarShowLabel: false,
            headerShown: false,
          }}
        >
          <Tab.Screen
            name="지도"
            component={MapScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="place" focused={focused} label="지도" />
              ),
            }}
          />
          <Tab.Screen
            name="커뮤니티"
            component={CommunityScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="group" focused={focused} label="커뮤니티" />
              ),
            }}
          />
          <Tab.Screen
            name="기여하기"
            component={ContributeScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="add-location-alt" focused={focused} label="기여하기" />
              ),
            }}
          />
          <Tab.Screen
            name="알림"
            component={NotificationScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="notifications" focused={focused} label="알림" />
              ),
            }}
          />
          <Tab.Screen
            name="마이페이지"
            component={MyPageScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="person" focused={focused} label="마이페이지" />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
