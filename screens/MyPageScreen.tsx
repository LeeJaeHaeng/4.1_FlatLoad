import React, { useState, useEffect, useCallback } from 'react';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/api';

const CERT_KEY_STORAGE = '@flatroad/certified_key';
const CERT_INFO_STORAGE = '@flatroad/certified_info';

interface CertInfo {
  name: string;
  affiliation: string;
  daysLeft: number;
}

type ManagedPermissionKey = 'camera' | 'mediaLibrary' | 'location';

type PermissionSnapshot = {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  accessPrivileges?: string | null;
  loading: boolean;
};

type PermissionResponseLike = {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
  accessPrivileges?: string | null;
};

const INITIAL_PERMISSION_STATE: PermissionSnapshot = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  loading: true,
};

const PERMISSION_ITEMS: Array<{
  key: ManagedPermissionKey;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  desc: string;
}> = [
  {
    key: 'camera',
    icon: 'photo-camera',
    label: '카메라',
    desc: '기여 사진을 직접 촬영할 때 사용됩니다',
  },
  {
    key: 'mediaLibrary',
    icon: 'photo-library',
    label: '갤러리',
    desc: '기여 사진을 갤러리에서 선택할 때 사용됩니다',
  },
  {
    key: 'location',
    icon: 'my-location',
    label: '위치',
    desc: '지도 현재 위치와 기여 위치 저장에 사용됩니다',
  },
];

const PERMISSION_HANDLERS: Record<ManagedPermissionKey, {
  get: () => Promise<PermissionResponseLike>;
  request: () => Promise<PermissionResponseLike>;
}> = {
  camera: {
    get: Camera.getCameraPermissionsAsync,
    request: Camera.requestCameraPermissionsAsync,
  },
  mediaLibrary: {
    get: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    request: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
  },
  location: {
    get: () => Location.getForegroundPermissionsAsync(),
    request: () => Location.requestForegroundPermissionsAsync(),
  },
};

function normalizePermission(response: PermissionResponseLike): PermissionSnapshot {
  const status = response.status ?? 'undetermined';
  const granted = response.granted === true || status === 'granted' || response.accessPrivileges === 'limited';
  return {
    status,
    granted,
    canAskAgain: response.canAskAgain ?? true,
    accessPrivileges: response.accessPrivileges ?? null,
    loading: false,
  };
}

function getPermissionStatusText(permission: PermissionSnapshot): string {
  if (permission.loading) return '확인 중';
  if (permission.accessPrivileges === 'limited') return '일부 허용';
  if (permission.granted) return '허용됨';
  if (permission.status === 'denied' && permission.canAskAgain === false) return '차단됨';
  if (permission.status === 'denied') return '거부됨';
  if (permission.status === 'unavailable') return '확인 불가';
  return '미설정';
}

export default function MyPageScreen() {
  const { user, logout } = useAuth();
  const [muteShutter, setMuteShutter] = useState(false);
  const [certKeyInput, setCertKeyInput] = useState('');
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [permissions, setPermissions] = useState<Record<ManagedPermissionKey, PermissionSnapshot>>({
    camera: INITIAL_PERMISSION_STATE,
    mediaLibrary: INITIAL_PERMISSION_STATE,
    location: INITIAL_PERMISSION_STATE,
  });

  const updatePermission = useCallback((key: ManagedPermissionKey, next: Partial<PermissionSnapshot>) => {
    setPermissions(prev => ({
      ...prev,
      [key]: { ...prev[key], ...next },
    }));
  }, []);

  const refreshPermissions = useCallback(async () => {
    await Promise.all(PERMISSION_ITEMS.map(async ({ key }) => {
      updatePermission(key, { loading: true });
      try {
        const response = await PERMISSION_HANDLERS[key].get();
        updatePermission(key, normalizePermission(response));
      } catch {
        updatePermission(key, {
          status: 'unavailable',
          granted: false,
          canAskAgain: false,
          accessPrivileges: null,
          loading: false,
        });
      }
    }));
  }, [updatePermission]);

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

  useEffect(() => {
    refreshPermissions();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshPermissions();
    });
    return () => subscription.remove();
  }, [refreshPermissions]);

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

  const openSystemSettings = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('설정 안내', '브라우저의 사이트 설정에서 카메라, 위치, 사진 접근 권한을 변경해주세요.');
      return;
    }
    try {
      await Linking.openSettings();
    } catch {
      Alert.alert('오류', '시스템 설정을 열 수 없습니다.');
    }
  };

  const togglePermission = async (key: ManagedPermissionKey, value: boolean) => {
    if (!value) {
      Alert.alert('권한 해제', '앱 권한 해제는 시스템 설정에서 변경할 수 있습니다.', [
        { text: '취소', style: 'cancel', onPress: refreshPermissions },
        { text: '설정 열기', onPress: openSystemSettings },
      ]);
      return;
    }

    updatePermission(key, { loading: true });
    try {
      const response = await PERMISSION_HANDLERS[key].request();
      const normalized = normalizePermission(response);
      updatePermission(key, normalized);
      if (!normalized.granted) {
        const message = normalized.canAskAgain
          ? '권한이 허용되지 않았습니다. 다시 시도하거나 시스템 설정을 확인해주세요.'
          : '권한이 차단되어 있습니다. 시스템 설정에서 권한을 허용해주세요.';
        Alert.alert('권한 필요', message, normalized.canAskAgain ? undefined : [
          { text: '취소', style: 'cancel' },
          { text: '설정 열기', onPress: openSystemSettings },
        ]);
      }
    } catch {
      updatePermission(key, { loading: false });
      Alert.alert('오류', '권한 상태를 변경할 수 없습니다.');
    }
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

        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>권한</Text>
          {PERMISSION_ITEMS.map(item => {
            const permission = permissions[item.key];
            const enabled = permission.granted;
            return (
              <View key={item.key} style={styles.permissionRow}>
                <MaterialIcons name={item.icon} size={20} color="#555" />
                <View style={styles.settingTextWrap}>
                  <View style={styles.permissionTitleRow}>
                    <Text style={styles.settingLabel}>{item.label}</Text>
                    <Text style={[
                      styles.permissionBadge,
                      enabled ? styles.permissionBadgeOn : styles.permissionBadgeOff,
                    ]}>
                      {getPermissionStatusText(permission)}
                    </Text>
                  </View>
                  <Text style={styles.settingDesc}>{item.desc}</Text>
                </View>
                {permission.loading ? (
                  <ActivityIndicator size="small" color="#4285F4" />
                ) : (
                  <Switch
                    value={enabled}
                    onValueChange={(value) => togglePermission(item.key, value)}
                    trackColor={{ false: '#ddd', true: '#4285F4' }}
                    thumbColor="#fff"
                  />
                )}
              </View>
            );
          })}
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
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  settingTextWrap: {
    flex: 1,
  },
  permissionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
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
  permissionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  permissionBadgeOn: {
    backgroundColor: '#E6F4EA',
    color: '#188038',
  },
  permissionBadgeOff: {
    backgroundColor: '#F1F3F4',
    color: '#777',
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
