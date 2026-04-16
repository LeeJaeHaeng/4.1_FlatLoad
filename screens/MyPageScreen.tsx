import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import {
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { auth } from '../utils/firebase';

// expo-auth-session이 웹 브라우저를 올바르게 닫도록 등록
WebBrowser.maybeCompleteAuthSession();

// ─────────────────────────────────────────────────────────────────
//  Google OAuth 클라이언트 ID
//  Google Cloud Console > API 및 서비스 > 사용자 인증 정보에서 발급
//  Android 앱용 OAuth 2.0 클라이언트 ID 입력 (패키지명: com.anonymous.MyApp)
// ─────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = '101038938383-e37ac02m8qn1fehmoo79tun7k0gt8r9e.apps.googleusercontent.com';
// ─────────────────────────────────────────────────────────────────

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export default function MyPageScreen() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(false);

  // Expo Auth Session 설정
  const redirectUri = AuthSession.makeRedirectUri();

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
    },
    discovery
  );

  // Google 로그인 처리
  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await promptAsync();
      if (result.type === 'success' && result.params.code) {
        // Authorization Code → Token 교환
        const tokenResponse = await AuthSession.exchangeCodeAsync(
          {
            clientId: GOOGLE_CLIENT_ID,
            code: result.params.code,
            redirectUri,
            extraParams: { code_verifier: request?.codeVerifier ?? '' },
          },
          discovery
        );

        // Firebase credential 생성 후 로그인
        const credential = GoogleAuthProvider.credential(
          tokenResponse.idToken ?? null,
          tokenResponse.accessToken
        );
        await signInWithCredential(auth, credential);
      } else if (result.type === 'error') {
        Alert.alert('로그인 오류', result.error?.message ?? '알 수 없는 오류');
      }
    } catch (e: any) {
      Alert.alert('로그인 실패', e.message ?? '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout();
          } catch {
            Alert.alert('오류', '로그아웃 중 오류가 발생했습니다.');
          }
        },
      },
    ]);
  };

  // ── 로그인 안 된 상태 ──────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loginContainer}>
          <View style={styles.logoWrap}>
            <MaterialIcons name="account-circle" size={80} color="#ccc" />
            <Text style={styles.appName}>마이페이지</Text>
            <Text style={styles.loginDesc}>
              로그인하고 장애물 기여 활동을{'\n'}기록으로 남겨보세요.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.googleButton, (!request || loading) && styles.buttonDisabled]}
            onPress={handleGoogleLogin}
            activeOpacity={0.85}
            disabled={!request || loading}
          >
            {loading ? (
              <ActivityIndicator color="#444" size="small" />
            ) : (
              <>
                <Image
                  source={{ uri: 'https://www.google.com/favicon.ico' }}
                  style={styles.googleIcon}
                />
                <Text style={styles.googleButtonText}>Google로 계속하기</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.termsText}>
            로그인 시 서비스 이용약관 및 개인정보처리방침에 동의합니다.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── 로그인 된 상태 ─────────────────────────────────────────────
  const displayName = user.displayName ?? '이름 없음';
  const email = user.email ?? '';
  const photoURL = user.photoURL;
  // Google 계정 ID (이메일 앞 부분 또는 uid)
  const googleId = email || user.uid;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.profileScroll}>
        {/* 프로필 카드 */}
        <View style={styles.profileCard}>
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <MaterialIcons name="person" size={40} color="#fff" />
            </View>
          )}
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.email}>{email}</Text>
        </View>

        {/* 계정 정보 */}
        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>계정 정보</Text>

          <View style={styles.infoRow}>
            <MaterialIcons name="badge" size={20} color="#4285F4" />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoLabel}>Google ID</Text>
              <Text style={styles.infoValue} selectable>{googleId}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <MaterialIcons name="verified-user" size={20} color="#34A853" />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoLabel}>Firebase UID</Text>
              <Text style={styles.infoValue} selectable>{user.uid}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <MaterialIcons name="login" size={20} color="#888" />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoLabel}>로그인 방법</Text>
              <Text style={styles.infoValue}>Google</Text>
            </View>
          </View>
        </View>

        {/* 로그아웃 버튼 */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <MaterialIcons name="logout" size={20} color="#e53935" />
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  // ── 로그인 전 ─────────────────────────────────────────────────
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 48,
  },
  appName: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#222',
    marginTop: 12,
  },
  loginDesc: {
    marginTop: 10,
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  termsText: {
    marginTop: 20,
    fontSize: 11,
    color: '#bbb',
    textAlign: 'center',
    lineHeight: 18,
  },
  // ── 로그인 후 ─────────────────────────────────────────────────
  profileScroll: {
    padding: 20,
    gap: 16,
  },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#eee',
  },
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#4285F4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  displayName: {
    marginTop: 14,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#222',
  },
  email: {
    marginTop: 4,
    fontSize: 14,
    color: '#888',
  },
  infoSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoTextWrap: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    color: '#aaa',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#ffcdd2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e53935',
  },
});
