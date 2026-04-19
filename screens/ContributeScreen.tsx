import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import {
  saveObstacle,
  getMyObstacles,
  getTopContributors,
  ObstacleRecord,
  TopContributor,
} from '../utils/database';
import {
  apiCreateObstacle,
  apiGetMyObstacles,
  apiGetTopContributors,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';

type Screen = 'list' | 'camera' | 'preview';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function ContributeScreen() {
  const { user } = useAuth();
  const [screen, setScreen] = useState<Screen>('list');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [muted, setMuted] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const [myObstacles, setMyObstacles] = useState<ObstacleRecord[]>([]);
  const [topContributors, setTopContributors] = useState<TopContributor[]>([]);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('settings.muteShutter').then((val) => {
      if (val !== null) setMuted(val === 'true');
    });
  }, []);

  const toggleMuted = (value: boolean) => {
    setMuted(value);
    AsyncStorage.setItem('settings.muteShutter', String(value));
  };

  const loadListData = useCallback(async () => {
    setListLoading(true);
    try {
      const [obstacles, top] = await Promise.all([
        user ? apiGetMyObstacles(user.uid).catch(() => getMyObstacles(user.uid)) : Promise.resolve([]),
        apiGetTopContributors().catch(() => getTopContributors(3)),
      ]);
      setMyObstacles(obstacles as ObstacleRecord[]);
      setTopContributors(top as TopContributor[]);
    } finally {
      setListLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (screen === 'list') loadListData();
    }, [screen, loadListData])
  );

  const enterCamera = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('권한 필요', '카메라 접근 권한이 필요합니다.');
        return;
      }
    }
    setScreen('camera');
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        setCapturedUri(photo.uri);
        setScreen('preview');
      }
    } catch {
      Alert.alert('오류', '사진 촬영에 실패했습니다.');
    }
  };

  const handleSave = async () => {
    if (!capturedUri) return;
    setSaving(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '위치 접근 권한이 필요합니다.');
        setSaving(false);
        return;
      }

      let loc = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
      if (!loc) {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      }

      // 백엔드 API로 저장 (AI 분석 포함) — 실패 시 로컬 SQLite 폴백
      let aiLabel: string | null = null;
      let aiConfidence: number | null = null;
      try {
        const result = await apiCreateObstacle(
          capturedUri,
          loc.coords.latitude,
          loc.coords.longitude,
          user?.uid ?? '',
          user?.email ?? '',
          user?.displayName ?? ''
        );
        aiLabel = result.aiLabel;
        aiConfidence = result.aiConfidence;
      } catch {
        // 서버 연결 실패 시 로컬 저장
        await saveObstacle(
          capturedUri,
          loc.coords.latitude,
          loc.coords.longitude,
          user?.uid ?? '',
          user?.email ?? '',
          user?.displayName ?? ''
        );
      }

      const aiMsg = aiLabel
        ? `\n\n🤖 AI 분석 결과: ${aiLabel} (신뢰도 ${Math.round((aiConfidence ?? 0) * 100)}%)`
        : '';
      Alert.alert('저장 완료', `장애물 정보가 저장되었습니다.${aiMsg}`, [
        {
          text: '확인',
          onPress: () => {
            setCapturedUri(null);
            setScreen('list');
            loadListData();
          },
        },
      ]);
    } catch (e) {
      Alert.alert('오류', `저장 중 문제가 발생했습니다.\n${(e as Error)?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setCapturedUri(null);
    setScreen('list');
  };

  // ── 목록 화면 ───────────────────────────────────────────────────
  if (screen === 'list') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.listScroll}>

          {/* Top 3 리더보드 */}
          <View style={styles.leaderCard}>
            <Text style={styles.leaderTitle}>👍 좋아요 TOP 3</Text>
            {topContributors.length === 0 ? (
              <Text style={styles.leaderEmpty}>아직 평가된 기여가 없습니다</Text>
            ) : (
              topContributors.map((c, i) => (
                <View key={c.userId} style={styles.leaderRow}>
                  <Text style={styles.leaderMedal}>{MEDAL[i]}</Text>
                  <View style={styles.leaderInfo}>
                    <Text style={styles.leaderName}>{c.displayName || c.userEmail || '익명'}</Text>
                    <Text style={styles.leaderEmail}>{c.userEmail}</Text>
                  </View>
                  <View style={styles.leaderLikes}>
                    <MaterialIcons name="thumb-up" size={14} color="#4285F4" />
                    <Text style={styles.leaderLikeCount}>{c.totalLikes}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* 내 기여 목록 */}
          <Text style={styles.sectionTitle}>내 기여 목록</Text>
          {!user ? (
            <View style={styles.loginPrompt}>
              <MaterialIcons name="account-circle" size={40} color="#ccc" />
              <Text style={styles.loginPromptText}>로그인하면 내 기여 목록을 볼 수 있습니다</Text>
            </View>
          ) : listLoading ? (
            <ActivityIndicator color="#4285F4" style={{ marginTop: 24 }} />
          ) : myObstacles.length === 0 ? (
            <View style={styles.emptyWrap}>
              <MaterialIcons name="add-location-alt" size={40} color="#ccc" />
              <Text style={styles.emptyText}>아직 기여한 장애물이 없습니다</Text>
            </View>
          ) : (
            myObstacles.map((item) => (
              <View key={item.id} style={styles.obstacleItem}>
                <Image source={{ uri: item.photoUri }} style={styles.obstacleThumb} />
                <View style={styles.obstacleInfo}>
                  <Text style={styles.obstacleDate}>
                    {new Date(item.createdAt).toLocaleDateString('ko-KR', {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </Text>
                  <Text style={styles.obstacleCoords}>
                    {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                  </Text>
                  <View style={styles.obstacleVotes}>
                    <MaterialIcons name="thumb-up" size={13} color="#4285F4" />
                    <Text style={styles.obstacleVoteText}>{item.likes}</Text>
                    <MaterialIcons name="thumb-down" size={13} color="#e53935" style={{ marginLeft: 8 }} />
                    <Text style={styles.obstacleVoteText}>{item.dislikes}</Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>

        {/* 촬영 FAB */}
        <TouchableOpacity style={styles.fab} onPress={enterCamera} activeOpacity={0.85}>
          <MaterialIcons name="camera-alt" size={26} color="#fff" />
          <Text style={styles.fabText}>촬영하기</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── 카메라 화면 ─────────────────────────────────────────────────
  if (screen === 'camera') {
    return (
      <View style={styles.fullScreen}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mute={muted}
        />

        <SafeAreaView style={styles.cameraTopBar}>
          <TouchableOpacity onPress={() => setScreen('list')} style={styles.cameraTopBtn}>
            <MaterialIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.cameraTopTitle}>장애물 촬영</Text>
          <View style={styles.cameraTopRight}>
            <TouchableOpacity onPress={() => toggleMuted(!muted)} style={styles.cameraTopBtn}>
              <MaterialIcons name={muted ? 'volume-off' : 'volume-up'} size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
              style={styles.cameraTopBtn}
            >
              <MaterialIcons name="flip-camera-ios" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={styles.cameraGuide}>
          <Text style={styles.cameraGuideText}>장애물이 화면 중앙에 오도록 맞춰주세요</Text>
        </View>

        <View style={styles.cameraBottomBar}>
          <TouchableOpacity style={styles.shutterButton} onPress={takePicture} activeOpacity={0.8}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── 미리보기 화면 ───────────────────────────────────────────────
  return (
    <View style={styles.fullScreen}>
      {capturedUri && (
        <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      <View style={styles.previewOverlay} />
      <SafeAreaView style={styles.previewContent}>
        <Text style={styles.previewTitle}>촬영된 사진</Text>
        <Text style={styles.previewSub}>이 사진을 저장하시겠습니까?{'\n'}저장 시 현재 위치와 날짜가 함께 기록됩니다.</Text>
        <View style={styles.previewButtons}>
          <TouchableOpacity
            style={[styles.previewBtn, styles.cancelBtn]}
            onPress={handleCancel}
            disabled={saving}
          >
            <MaterialIcons name="close" size={20} color="#fff" />
            <Text style={styles.previewBtnText}>취소</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.previewBtn, styles.saveBtn]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="save" size={20} color="#fff" />
                <Text style={styles.previewBtnText}>저장하기</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  listScroll: { padding: 16, paddingBottom: 100 },

  // 리더보드
  leaderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  leaderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 12,
  },
  leaderEmpty: { fontSize: 13, color: '#bbb', textAlign: 'center', paddingVertical: 8 },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
    gap: 10,
  },
  leaderMedal: { fontSize: 24, width: 32, textAlign: 'center' },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 14, fontWeight: '600', color: '#333' },
  leaderEmail: { fontSize: 11, color: '#aaa', marginTop: 1 },
  leaderLikes: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leaderLikeCount: { fontSize: 15, fontWeight: 'bold', color: '#4285F4' },

  // 내 기여 목록
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  loginPrompt: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  loginPromptText: { fontSize: 13, color: '#aaa', textAlign: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 13, color: '#aaa' },
  obstacleItem: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  obstacleThumb: { width: 90, height: 90, backgroundColor: '#eee' },
  obstacleInfo: { flex: 1, padding: 12, justifyContent: 'center', gap: 4 },
  obstacleDate: { fontSize: 13, fontWeight: '600', color: '#333' },
  obstacleCoords: { fontSize: 11, color: '#999' },
  obstacleVotes: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  obstacleVoteText: { fontSize: 12, color: '#555', fontWeight: '600' },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF5722',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
    gap: 8,
  },
  fabText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  // 카메라
  fullScreen: { flex: 1, backgroundColor: '#000' },
  cameraTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  cameraTopBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  cameraTopTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  cameraTopRight: { flexDirection: 'row', alignItems: 'center' },
  cameraGuide: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  cameraGuideText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  cameraBottomBar: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  // 미리보기
  previewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  previewContent: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  previewTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  previewSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  previewButtons: { flexDirection: 'row', gap: 12 },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  cancelBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  saveBtn: { backgroundColor: '#FF5722' },
  previewBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
