import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { saveObstacle } from '../utils/database';
import { useAuth } from '../context/AuthContext';

type Screen = 'menu' | 'camera' | 'preview';

export default function ContributeScreen() {
  const { user } = useAuth();
  const [screen, setScreen] = useState<Screen>('menu');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // 카메라 화면 진입 시 권한 요청
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
      // 위치 권한 확인 및 취득
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '위치 접근 권한이 필요합니다.');
        setSaving(false);
        return;
      }

      // 마지막 알려진 위치를 먼저 시도 (빠름), 없으면 현재 위치 측정
      let loc = await Location.getLastKnownPositionAsync({
        maxAge: 60_000,
        requiredAccuracy: 100,
      });
      if (!loc) {
        loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      await saveObstacle(
        capturedUri,
        loc.coords.latitude,
        loc.coords.longitude,
        user?.uid ?? '',
        user?.email ?? '',
        user?.displayName ?? ''
      );

      Alert.alert('저장 완료', '장애물 정보가 저장되었습니다.', [
        {
          text: '확인',
          onPress: () => {
            setCapturedUri(null);
            setScreen('menu');
          },
        },
      ]);
    } catch (e) {
      console.error('[ContributeScreen] 저장 오류:', e);
      Alert.alert('오류', `저장 중 문제가 발생했습니다.\n${(e as Error)?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setCapturedUri(null);
    setScreen('menu');
  };

  // 메인 메뉴
  if (screen === 'menu') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <MaterialIcons name="edit-location-alt" size={36} color="#FF5722" />
          <Text style={styles.headerTitle}>기여하기</Text>
          <Text style={styles.headerSub}>장애물을 발견했나요? 사진으로 기록해 주세요.</Text>
        </View>

        <View style={styles.menuList}>
          <TouchableOpacity style={styles.menuItem} onPress={enterCamera} activeOpacity={0.8}>
            <View style={styles.menuIconWrap}>
              <MaterialIcons name="camera-alt" size={28} color="#fff" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>카메라 촬영하기</Text>
              <Text style={styles.menuDesc}>카메라로 장애물을 직접 촬영합니다</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#ccc" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 카메라 화면
  if (screen === 'camera') {
    return (
      <View style={styles.fullScreen}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
        />

        {/* 상단 닫기 버튼 */}
        <SafeAreaView style={styles.cameraTopBar}>
          <TouchableOpacity onPress={() => setScreen('menu')} style={styles.cameraTopBtn}>
            <MaterialIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.cameraTopTitle}>장애물 촬영</Text>
          <TouchableOpacity
            onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
            style={styles.cameraTopBtn}
          >
            <MaterialIcons name="flip-camera-ios" size={28} color="#fff" />
          </TouchableOpacity>
        </SafeAreaView>

        {/* 촬영 가이드 */}
        <View style={styles.cameraGuide}>
          <Text style={styles.cameraGuideText}>장애물이 화면 중앙에 오도록 맞춰주세요</Text>
        </View>

        {/* 하단 촬영 버튼 */}
        <View style={styles.cameraBottomBar}>
          <TouchableOpacity style={styles.shutterButton} onPress={takePicture} activeOpacity={0.8}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 미리보기 화면
  return (
    <View style={styles.fullScreen}>
      {capturedUri && (
        <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}

      {/* 어두운 오버레이 */}
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
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 32,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#222',
    marginTop: 8,
  },
  headerSub: {
    marginTop: 6,
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  menuList: {
    marginTop: 20,
    marginHorizontal: 16,
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    gap: 14,
  },
  menuIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FF5722',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuTextWrap: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  menuDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  cameraTopBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraTopTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
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
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  previewContent: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  previewTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  previewSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  previewButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  cancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  saveBtn: {
    backgroundColor: '#FF5722',
  },
  previewBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
