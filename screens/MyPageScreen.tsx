import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

export default function MyPageScreen() {
  const [muteShutter, setMuteShutter] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('settings.muteShutter').then((val) => {
      if (val !== null) setMuteShutter(val === 'true');
    });
  }, []);

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
            <MaterialIcons name="person" size={40} color="#fff" />
          </View>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
          <Text style={styles.displayName}>데모 사용자</Text>
          <Text style={styles.email}>demo@flatroad.app</Text>
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
  demoBadge: {
    marginTop: 10,
    backgroundColor: '#F5A623',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  demoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
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
});
