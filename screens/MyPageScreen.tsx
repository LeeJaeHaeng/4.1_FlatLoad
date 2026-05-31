import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/api';

const CERT_KEY_STORAGE = '@flatroad/certified_key';
const CERT_INFO_STORAGE = '@flatroad/certified_info';

interface CertInfo {
  name: string;
  affiliation: string;
  daysLeft: number;
}

export default function MyPageScreen() {
  const { user, logout } = useAuth();
  const [muteShutter, setMuteShutter] = useState(false);
  const [certKeyInput, setCertKeyInput] = useState('');
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certLoading, setCertLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('settings.muteShutter').then((val) => {
      if (val !== null) setMuteShutter(val === 'true');
    });
    AsyncStorage.getItem(CERT_INFO_STORAGE).then((val) => {
      if (val) {
        try { setCertInfo(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  const verifyCertKey = async () => {
    const key = certKeyInput.trim();
    if (!key) return;
    setCertLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/certified/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key }),
      });
      const data = await res.json();
      if (data.valid) {
        const info: CertInfo = { name: data.name, affiliation: data.affiliation, daysLeft: data.daysLeft };
        setCertInfo(info);
        await AsyncStorage.setItem(CERT_KEY_STORAGE, key);
        await AsyncStorage.setItem(CERT_INFO_STORAGE, JSON.stringify(info));
        setCertKeyInput('');
        Alert.alert('인증 완료', `${data.name}(${data.affiliation}) 인증된 사용자로 등록되었습니다.`);
      } else if (data.reason === 'expired') {
        Alert.alert('만료된 키', '유효 기간이 지난 인증 키입니다. 새 키를 발급받으세요.');
      } else {
        Alert.alert('인증 실패', '올바르지 않은 인증 키입니다.');
      }
    } catch {
      Alert.alert('오류', '서버에 연결할 수 없습니다.');
    } finally {
      setCertLoading(false);
    }
  };

  const removeCert = async () => {
    Alert.alert('인증 해제', '인증된 사용자 상태를 해제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(CERT_KEY_STORAGE);
          await AsyncStorage.removeItem(CERT_INFO_STORAGE);
          setCertInfo(null);
        },
      },
    ]);
  };

  const toggleMuteShutter = (value: boolean) => {
    setMuteShutter(value);
    AsyncStorage.setItem('settings.muteShutter', String(value));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 프로필 카드 */}
        <View style={styles.profileCard}>
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>
              {user?.displayName?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <Text style={styles.displayName}>{user?.displayName ?? '사용자'}</Text>
          <Text style={styles.email}>uid: {user?.uid?.slice(0, 8) ?? '—'}…</Text>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={() =>
              Alert.alert('닉네임 변경', '닉네임을 초기화하고 다시 입력하시겠습니까?', [
                { text: '취소', style: 'cancel' },
                { text: '초기화', style: 'destructive', onPress: logout },
              ])
            }
          >
            <Text style={styles.logoutBtnText}>닉네임 초기화</Text>
          </TouchableOpacity>
        </View>

        {/* 설정 섹션 */}
        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>설정</Text>
          <View style={styles.settingRow}>
            <MaterialIcons name="volume-off" size={20} color="#555" />
            <View style={styles.settingTextWrap}>
              <Text style={styles.settingLabel}>카메라 셔터음 끄기</Text>
              <Text style={styles.settingDesc}>촬영 시 소리가 나지 않습니다</Text>
            </View>
            <Switch
              value={muteShutter}
              onValueChange={toggleMuteShutter}
              trackColor={{ false: '#ddd', true: '#4285F4' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* 인증 사용자 섹션 */}
        <View style={styles.certSection}>
          <Text style={styles.sectionTitle}>기관 인증</Text>
          {certInfo ? (
            <View style={styles.certActiveBox}>
              <View style={styles.certActiveHeader}>
                <Text style={styles.certStar}>⭐</Text>
                <Text style={styles.certActiveTitle}>인증된 사용자입니다</Text>
              </View>
              <Text style={styles.certName}>{certInfo.name}</Text>
              {certInfo.affiliation ? (
                <Text style={styles.certAffiliation}>{certInfo.affiliation}</Text>
              ) : null}
              <Text style={styles.certDays}>유효 기간 {certInfo.daysLeft}일 남음</Text>
              <TouchableOpacity onPress={removeCert} style={styles.certRemoveBtn}>
                <Text style={styles.certRemoveBtnText}>인증 해제</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.certDesc}>
                기관 인증 코드를 입력하면 기여 내용에 ⭐ 인증 마크가 표시됩니다.
              </Text>
              <View style={styles.certInputRow}>
                <TextInput
                  style={styles.certInput}
                  value={certKeyInput}
                  onChangeText={setCertKeyInput}
                  placeholder="인증 코드 입력 (64자)"
                  placeholderTextColor="#bbb"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.certVerifyBtn, certLoading && { opacity: 0.6 }]}
                  onPress={verifyCertKey}
                  disabled={certLoading || !certKeyInput.trim()}
                >
                  {certLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.certVerifyBtnText}>확인</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* 앱 정보 */}
        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>앱 정보</Text>
          <View style={styles.infoRow}>
            <MaterialIcons name="info-outline" size={20} color="#4285F4" />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoLabel}>버전</Text>
              <Text style={styles.infoValue}>1.0.0 (데모)</Text>
            </View>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcons name="directions-walk" size={20} color="#34A853" />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoLabel}>서비스</Text>
              <Text style={styles.infoValue}>FlatRoad — 전동이동보조기기 안전 경로 안내</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scroll: {
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
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#4285F4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
  },
  logoutBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  logoutBtnText: {
    fontSize: 13,
    color: '#888',
  },
  displayName: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#222',
  },
  email: {
    marginTop: 4,
    fontSize: 14,
    color: '#888',
  },
  settingsSection: {
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  settingTextWrap: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  settingDesc: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 2,
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
  certSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  certDesc: {
    fontSize: 13,
    color: '#888',
    marginBottom: 10,
    lineHeight: 18,
  },
  certInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  certInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#333',
  },
  certVerifyBtn: {
    backgroundColor: '#4285F4',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  certVerifyBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  certActiveBox: {
    backgroundColor: '#E8F0FE',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  certActiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  certStar: {
    fontSize: 20,
  },
  certActiveTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1967D2',
  },
  certName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  certAffiliation: {
    fontSize: 13,
    color: '#555',
  },
  certDays: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  certRemoveBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  certRemoveBtnText: {
    fontSize: 12,
    color: '#888',
  },
});
