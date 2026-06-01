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
  Modal,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as exifr from 'exifr';
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
  apiAnalyzeImage,
  apiGetMyObstacles,
  apiGetTopContributors,
  apiUpdateObstacleLabel,
  apiGetDeleteNotifications,
  apiMarkNotificationRead,
  ApiObstacle,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getDetectionOverlayLayout } from '../utils/detectionOverlay';

type Screen = 'list' | 'camera' | 'preview';
type LocationCoords = { latitude: number; longitude: number };
type PhotoSource = 'camera' | 'gallery';
type PickedImageAsset = ImagePicker.ImagePickerAsset & { cleanup?: () => void };

const TOP_CONTRIBUTORS_CACHE_KEY = '@flatroad/cache/top-contributors';
const MY_OBSTACLES_CACHE_PREFIX = '@flatroad/cache/my-obstacles/';
const LIST_REFRESH_INTERVAL_MS = 60_000;
const LIST_API_TIMEOUT_MS = 4_500;
type Detection = { label: string; confidence: number; bbox: [number, number, number, number] };

const MEDAL = ['🥇', '🥈', '🥉'];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('request timeout')), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
const LABEL_KO: Record<string, string> = {
  person: '사람', pole: '전봇대', bollard: '볼라드', tree_trunk: '나무',
  car: '자동차', traffic_light: '신호등', truck: '트럭', bus: '버스',
  traffic_sign: '표지판', motorcycle: '오토바이', movable_signage: '이동간판',
  potted_plant: '화분', wheelchair: '휠체어',
};
const BBOX_COLORS = [
  '#FF5722', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0',
  '#00BCD4', '#F44336', '#3F51B5', '#8BC34A', '#FF5252',
];

const { width: SCREEN_W } = Dimensions.get('window');
const MAX_GALLERY_PHOTO_AGE_HOURS = 48;

function stripStaleBlobPhoto<T extends { photoUri?: string }>(item: T): T {
  if (typeof item.photoUri !== 'string' || !item.photoUri.startsWith('blob:')) return item;
  return { ...item, photoUri: '' };
}

function stripStaleBlobPhotos<T extends { photoUri?: string }>(items: T[]): T[] {
  return items.map(stripStaleBlobPhoto);
}

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;
  const dateStr = value.trim();
  const m = dateStr.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const parsed = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function gpsToDecimal(value: number | number[] | string, ref: string = ''): number {
  const dec = Array.isArray(value)
    ? Number(value[0]) + Number(value[1] ?? 0) / 60 + Number(value[2] ?? 0) / 3600
    : Number(value);
  return ref === 'S' || ref === 'W' ? -dec : dec;
}

async function readWebExif(asset: ImagePicker.ImagePickerAsset): Promise<Record<string, any> | null> {
  if (Platform.OS !== 'web') return null;
  try {
    const blob = await getWebAssetBlob(asset);
    return await exifr.parse(blob, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      translateValues: false,
    } as any) as Record<string, any> | null;
  } catch {
    return null;
  }
}

async function getWebAssetBlob(asset: ImagePicker.ImagePickerAsset): Promise<Blob> {
  const file = (asset as any).file;
  if (typeof Blob !== 'undefined' && file instanceof Blob) return file;

  const response = await fetch(asset.uri);
  if (!response.ok) {
    throw new Error(`image fetch failed: ${response.status}`);
  }
  return response.blob();
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('image read failed'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('image read failed'));
    reader.readAsDataURL(blob);
  });
}

async function materializeImageUri(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (Platform.OS !== 'web' || asset.uri.startsWith('data:')) return asset.uri;
  return blobToDataUri(await getWebAssetBlob(asset));
}

function pickWebImageAsset(): Promise<PickedImageAsset | null> {
  if (Platform.OS !== 'web') return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    const removeInput = () => {
      input.onchange = null;
      input.onerror = null;
      input.removeEventListener('cancel', handleCancel);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const handleCancel = () => {
      removeInput();
      resolve(null);
    };

    input.onchange = () => {
      try {
        const file = input.files?.[0];
        removeInput();
        if (!file) {
          resolve(null);
          return;
        }

        const objectUrl = URL.createObjectURL(file);
        resolve({
          uri: objectUrl,
          width: 0,
          height: 0,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
          file,
          cleanup: () => URL.revokeObjectURL(objectUrl),
        } as PickedImageAsset);
      } catch (error) {
        removeInput();
        reject(error);
      }
    };

    input.onerror = () => {
      removeInput();
      reject(new Error('image picker failed'));
    };
    input.addEventListener('cancel', handleCancel);
    document.body.appendChild(input);
    input.click();
  });
}

function getTakenAtFromExif(exif: Record<string, any>): Date | null {
  return parseExifDate(
    exif.DateTimeOriginal ??
    exif.CreateDate ??
    exif.DateTimeDigitized ??
    exif.DateTime ??
    exif.ModifyDate
  );
}

function getCoordsFromExif(exif: Record<string, any>): { latitude: number; longitude: number } | null {
  const latitude = typeof exif.latitude === 'number'
    ? exif.latitude
    : exif.GPSLatitude == null
      ? null
      : gpsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef ?? 'N');
  const longitude = typeof exif.longitude === 'number'
    ? exif.longitude
    : exif.GPSLongitude == null
      ? null
      : gpsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef ?? 'E');

  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function DetectionOverlay({ detections, imgWidth, imgHeight }: {
  detections: Detection[];
  imgWidth: number;
  imgHeight: number;
}) {
  return (
    <>
      {detections.map((d, i) => {
        const color = BBOX_COLORS[i % BBOX_COLORS.length];
        const label = LABEL_KO[d.label] ?? d.label;
        const layout = getDetectionOverlayLayout(d.bbox, imgWidth, imgHeight);
        return (
          <React.Fragment key={`${d.label}-${i}`}>
            <View
              style={{
                position: 'absolute',
                left: layout.boxLeft,
                top: layout.boxTop,
                width: layout.boxWidth,
                height: layout.boxHeight,
                borderWidth: 2,
                borderColor: color,
                borderRadius: 4,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: layout.labelLeft,
                top: layout.labelTop,
                maxWidth: layout.labelMaxWidth,
                minWidth: 74,
                backgroundColor: color,
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 3,
              }}
            >
              <Text numberOfLines={1} style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                {label} {Math.round(d.confidence * 100)}%
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function ContributeScreen() {
  const { user } = useAuth();
  const [screen, setScreen] = useState<Screen>('list');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [muted, setMuted] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [exifCoords, setExifCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [photoSource, setPhotoSource] = useState<PhotoSource | null>(null);
  const [manualLabel, setManualLabel] = useState('');
  const [previewAnalysis, setPreviewAnalysis] = useState<{
    aiLabel: string | null;
    aiConfidence: number | null;
    aiDetections: Detection[];
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const [myObstacles, setMyObstacles] = useState<ObstacleRecord[]>([]);
  const [topContributors, setTopContributors] = useState<TopContributor[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ObstacleRecord | null>(null);
  const [detailImgSize, setDetailImgSize] = useState({ w: SCREEN_W - 48, h: 240 });

  const [labelPicker, setLabelPicker] = useState<{
    obstacleId: number;
    detections: Detection[];
  } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('settings.muteShutter').then((val) => {
      if (val !== null) setMuted(val === 'true');
    });
  }, []);

  const toggleMuted = (value: boolean) => {
    setMuted(value);
    AsyncStorage.setItem('settings.muteShutter', String(value));
  };

  const lastListLoadRef = useRef(0);

  const loadListData = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastListLoadRef.current < LIST_REFRESH_INTERVAL_MS) {
      return;
    }
    lastListLoadRef.current = now;

    let hasWarmData = myObstacles.length > 0 || topContributors.length > 0;
    try {
      const [cachedMine, cachedTop] = await Promise.all([
        user ? AsyncStorage.getItem(`${MY_OBSTACLES_CACHE_PREFIX}${user.uid}`) : Promise.resolve(null),
        AsyncStorage.getItem(TOP_CONTRIBUTORS_CACHE_KEY),
      ]);
      if (cachedMine) {
        const parsedMine = JSON.parse(cachedMine);
        if (Array.isArray(parsedMine)) {
          const sanitizedMine = stripStaleBlobPhotos(parsedMine as ObstacleRecord[]);
          setMyObstacles(sanitizedMine);
          if (JSON.stringify(sanitizedMine) !== cachedMine) {
            AsyncStorage.setItem(`${MY_OBSTACLES_CACHE_PREFIX}${user?.uid}`, JSON.stringify(sanitizedMine)).catch(() => {});
          }
          hasWarmData = true;
        }
      }
      if (cachedTop) {
        const parsedTop = JSON.parse(cachedTop);
        if (Array.isArray(parsedTop)) {
          setTopContributors(parsedTop as TopContributor[]);
          hasWarmData = true;
        }
      }
    } catch {}

    if (!hasWarmData) setListLoading(true);
    try {
      const [obstacles, top] = await Promise.all([
        user
          ? withTimeout(apiGetMyObstacles(user.uid), LIST_API_TIMEOUT_MS).catch(() => getMyObstacles(user.uid))
          : Promise.resolve([]),
        withTimeout(apiGetTopContributors(), LIST_API_TIMEOUT_MS).catch(() => getTopContributors(3)),
      ]);
      const sanitizedObstacles = stripStaleBlobPhotos(obstacles as ObstacleRecord[]);
      setMyObstacles(sanitizedObstacles);
      setTopContributors(top as TopContributor[]);
      const cacheWrites: [string, string][] = [[TOP_CONTRIBUTORS_CACHE_KEY, JSON.stringify(top)]];
      if (user) cacheWrites.push([`${MY_OBSTACLES_CACHE_PREFIX}${user.uid}`, JSON.stringify(sanitizedObstacles)]);
      AsyncStorage.multiSet(cacheWrites).catch(() => {});
    } finally {
      setListLoading(false);
    }
  }, [myObstacles.length, topContributors.length, user]);

  useFocusEffect(
    useCallback(() => {
      if (screen === 'list') loadListData();
    }, [screen, loadListData])
  );

  useFocusEffect(
    useCallback(() => {
      const userId = user?.uid;
      if (!userId) return;
      apiGetDeleteNotifications(userId).then(notifications => {
        if (notifications.length === 0) return;
        const lines = notifications.map(n =>
          `• 제보 #${n.obstacleId} 삭제 사유: ${n.reason}`
        ).join('\n\n');
        Alert.alert('내 제보가 삭제되었습니다', lines, [{
          text: '확인',
          onPress: () => notifications.forEach(n => apiMarkNotificationRead(n.id)),
        }]);
      });
    }, [user])
  );

  const enterCamera = async () => {
    if (!user) return;
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('권한 필요', '카메라 접근 권한이 필요합니다.');
        return;
      }
    }
    setScreen('camera');
  };

  const pickFromGallery = async () => {
    if (!user) return;
    let asset: PickedImageAsset | null = null;
    try {
      if (Platform.OS === 'web') {
        asset = await pickWebImageAsset();
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('권한 필요', '갤러리 접근 권한이 필요합니다.');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          exif: true,
          quality: 0.8,
        });
        if (result.canceled) return;
        asset = result.assets[0] as PickedImageAsset;
      }
      if (!asset) return;

      const pickerExif = asset.exif as Record<string, any> | undefined;
      const webExif = await readWebExif(asset);
      const exif = { ...(pickerExif ?? {}), ...(webExif ?? {}) };
      const hasExif = Object.keys(exif).length > 0;

      if (hasExif) {
        const takenAt = getTakenAtFromExif(exif);
        if (takenAt) {
          const diffHours = (Date.now() - takenAt.getTime()) / (1000 * 60 * 60);
          if (diffHours < 0 || diffHours > MAX_GALLERY_PHOTO_AGE_HOURS) {
            Alert.alert(
              '업로드 불가',
              `촬영된 지 ${MAX_GALLERY_PHOTO_AGE_HOURS}시간이 지난 사진입니다.\n\n촬영 시각: ${takenAt.toLocaleString('ko-KR')}\n\n최근 ${MAX_GALLERY_PHOTO_AGE_HOURS}시간 이내에 촬영한 사진만 업로드할 수 있습니다.`
            );
            return;
          }
        }
      }

      const coords = hasExif ? getCoordsFromExif(exif) : null;
      const stableUri = await materializeImageUri(asset);
      setExifCoords(coords);
      setCapturedUri(stableUri);
      setPhotoSource('gallery');
      setScreen('preview');
    } catch {
      Alert.alert('오류', '사진을 불러오는 중 문제가 발생했습니다.\n다른 사진으로 다시 시도해주세요.');
    } finally {
      asset?.cleanup?.();
    }
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, shutterSound: !muted });
      if (photo?.uri) {
        const stableUri = await materializeImageUri(photo as ImagePicker.ImagePickerAsset);
        setCapturedUri(stableUri);
        setPhotoSource('camera');
        setScreen('preview');
      }
    } catch {
      Alert.alert('오류', '사진 촬영에 실패했습니다.');
    }
  };

  const handleSave = async () => {
    if (!capturedUri || analyzing) return;
    setSaving(true);
    try {
      let latitude: number;
      let longitude: number;

      if (exifCoords) {
        ({ latitude, longitude } = exifCoords);
      } else {
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
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      }

      const certKey = (await AsyncStorage.getItem('@flatroad/certified_key')) ?? '';

      let aiLabel: string | null = null;
      let aiConfidence: number | null = null;
      let aiDetections: Detection[] = [];
      let savedId: number | null = null;
      const trimmedManualLabel = manualLabel.trim();
      const previewLabelKo = previewAnalysis?.aiLabel ? (LABEL_KO[previewAnalysis.aiLabel] ?? previewAnalysis.aiLabel) : '';
      const manualOverride =
        trimmedManualLabel &&
        trimmedManualLabel !== previewAnalysis?.aiLabel &&
        trimmedManualLabel !== previewLabelKo
          ? trimmedManualLabel
          : '';
      try {
        const result = await apiCreateObstacle(
          capturedUri,
          latitude,
          longitude,
          user?.uid ?? '',
          user?.email ?? '',
          user?.displayName ?? '',
          certKey,
          manualOverride,
          previewAnalysis ?? undefined
        );
        aiLabel = result.aiLabel;
        aiConfidence = result.aiConfidence;
        aiDetections = (result.aiDetections as Detection[]) ?? [];
        savedId = result.id;
      } catch {
        await saveObstacle(
          capturedUri,
          latitude,
          longitude,
          user?.uid ?? '',
          user?.email ?? '',
          user?.displayName ?? ''
        );
      }

      const resetPreview = () => {
        setCapturedUri(null);
        setExifCoords(null);
        setPhotoSource(null);
        setManualLabel('');
        setPreviewAnalysis(null);
        setScreen('list');
        loadListData(true);
      };

      const finishSave = (finalLabel: string | null, finalConf: number | null) => {
        const labelKo = finalLabel ? (LABEL_KO[finalLabel] ?? finalLabel) : null;
        const aiMsg = labelKo
          ? `\n\n🤖 AI 감지: ${labelKo} (신뢰도 ${Math.round((finalConf ?? 0) * 100)}%)`
          : '';
        if (Platform.OS === 'web') {
          resetPreview();
          const alertFn = (globalThis as any).alert;
          if (typeof alertFn === 'function') alertFn(`저장 완료\n\n장애물 정보가 저장되었습니다.${aiMsg}`);
          return;
        }
        Alert.alert('저장 완료', `장애물 정보가 저장되었습니다.${aiMsg}`, [
          {
            text: '확인',
            onPress: resetPreview,
          },
        ]);
      };

      if (savedId && aiDetections.length > 1) {
        setLabelPicker({ obstacleId: savedId, detections: aiDetections });
        setCapturedUri(null);
        setExifCoords(null);
        setPhotoSource(null);
        setManualLabel('');
        setPreviewAnalysis(null);
        setScreen('list');
        return;
      }

      finishSave(aiLabel, aiConfidence);
    } catch (e) {
      Alert.alert('오류', `저장 중 문제가 발생했습니다.\n${(e as Error)?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  // 미리보기 진입 시 AI 자동 분석
  useEffect(() => {
    if (screen !== 'preview' || !capturedUri) return;
    let cancelled = false;
    setAnalyzing(true);
    setManualLabel('');
    setPreviewAnalysis(null);
    apiAnalyzeImage(capturedUri)
      .then(result => {
        if (cancelled) return;
        setPreviewAnalysis({
          aiLabel: result.aiLabel,
          aiConfidence: result.aiConfidence,
          aiDetections: result.aiDetections as Detection[],
        });
        if (result.aiLabel) {
          setManualLabel(LABEL_KO[result.aiLabel] ?? result.aiLabel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewAnalysis({ aiLabel: null, aiConfidence: null, aiDetections: [] });
        }
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, capturedUri]);

  const handleCancel = () => {
    setCapturedUri(null);
    setExifCoords(null);
    setPhotoSource(null);
    setManualLabel('');
    setPreviewAnalysis(null);
    setScreen('list');
  };

  const openDetail = (item: ObstacleRecord) => {
    const cleanItem = stripStaleBlobPhoto(item);
    setSelectedItem(cleanItem);
    // 이미지 원본 비율로 표시 크기 계산
    const maxW = SCREEN_W - 48;
    if (!cleanItem.photoUri) {
      setDetailImgSize({ w: maxW, h: 240 });
      return;
    }
    Image.getSize(
      cleanItem.photoUri,
      (w, h) => {
        const ratio = h / w;
        setDetailImgSize({ w: maxW, h: Math.min(maxW * ratio, 360) });
      },
      () => setDetailImgSize({ w: maxW, h: 240 })
    );
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
            myObstacles.map((item) => {
              const detections: Detection[] = (item as any).aiDetections ?? [];
              const hasAI = detections.length > 0 || (!!(item as any).aiLabel && !!((item as any).aiConfidence));
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.obstacleItem}
                  onPress={() => openDetail(item)}
                  activeOpacity={0.75}
                >
                  <View style={styles.thumbWrap}>
                    {item.photoUri ? (
                    <Image source={{ uri: item.photoUri }} style={styles.obstacleThumb} />
                  ) : (
                    <View style={[styles.obstacleThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' }]}>
                      <Text style={{ fontSize: 24 }}>⚠️</Text>
                    </View>
                  )}
                    {hasAI && (
                      <View style={styles.aiThumbBadge}>
                        <Text style={styles.aiThumbBadgeText}>AI</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.obstacleInfo}>
                    <Text style={styles.obstacleDate}>
                      {(item as any).isCertified ? '⭐ ' : ''}
                      {new Date(item.createdAt).toLocaleDateString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </Text>
                    <Text style={styles.obstacleCoords}>
                      {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                    </Text>
                    {(item as any).aiLabel ? (
                      <View style={styles.aiLabelRow}>
                        <Text style={styles.aiLabelText}>
                          🤖 {LABEL_KO[(item as any).aiLabel] ?? (item as any).aiLabel}
                          {(item as any).aiConfidence
                            ? ` · ${Math.round((item as any).aiConfidence * 100)}%`
                            : ''}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.obstacleVotes}>
                      <MaterialIcons name="thumb-up" size={13} color="#4285F4" />
                      <Text style={styles.obstacleVoteText}>{item.likes}</Text>
                      <MaterialIcons name="thumb-down" size={13} color="#e53935" style={{ marginLeft: 8 }} />
                      <Text style={styles.obstacleVoteText}>{item.dislikes}</Text>
                      {detections.length > 1 && (
                        <Text style={styles.moreDetectText}> · +{detections.length - 1}개 더</Text>
                      )}
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#ccc" />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {/* FAB 영역 */}
        <View style={styles.fabRow}>
          <TouchableOpacity style={styles.fabSecondary} onPress={pickFromGallery} activeOpacity={0.85}>
            <MaterialIcons name="photo-library" size={24} color="#fff" />
            <Text style={styles.fabSecondaryText}>갤러리</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={enterCamera} activeOpacity={0.85}>
            <MaterialIcons name="camera-alt" size={26} color="#fff" />
            <Text style={styles.fabText}>촬영하기</Text>
          </TouchableOpacity>
        </View>

        {/* 상세 보기 모달 (감지 결과 시각화) */}
        <Modal
          visible={!!selectedItem}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedItem(null)}
        >
          <View style={styles.detailOverlay}>
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>장애물 상세</Text>
                <TouchableOpacity onPress={() => setSelectedItem(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>

              {selectedItem && (() => {
                const detections: Detection[] = (selectedItem as any).aiDetections ?? [];
                const { w: imgW, h: imgH } = detailImgSize;
                return (
                  <>
                    {/* 이미지 + 바운딩 박스 오버레이 */}
                    <View style={[styles.detailImgWrap, { width: imgW, height: imgH }]}>
                      {selectedItem.photoUri ? (
                        <Image
                          source={{ uri: selectedItem.photoUri }}
                          style={{ width: imgW, height: imgH, borderRadius: 10 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={{ width: imgW, height: imgH, borderRadius: 10, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 48 }}>⚠️</Text>
                          <Text style={{ color: '#888', marginTop: 8 }}>사진 없음</Text>
                        </View>
                      )}
                      {detections.length > 0 && (
                        <View style={{ position: 'absolute', left: 0, top: 0, width: imgW, height: imgH }}>
                          <DetectionOverlay detections={detections} imgWidth={imgW} imgHeight={imgH} />
                        </View>
                      )}
                      {detections.length === 0 && (
                        <View style={styles.noAiOverlay}>
                          <Text style={styles.noAiText}>AI 감지 없음</Text>
                        </View>
                      )}
                    </View>

                    {/* 감지 목록 */}
                    {detections.length > 0 && (
                      <View style={styles.detectList}>
                        <Text style={styles.detectListTitle}>감지된 객체</Text>
                        {detections.map((d, i) => (
                          <View key={i} style={styles.detectRow}>
                            <View style={[styles.detectDot, { backgroundColor: BBOX_COLORS[i % BBOX_COLORS.length] }]} />
                            <Text style={styles.detectLabel}>{LABEL_KO[d.label] ?? d.label}</Text>
                            <View style={styles.detectBar}>
                              <View style={[styles.detectBarFill, {
                                width: `${Math.round(d.confidence * 100)}%` as any,
                                backgroundColor: BBOX_COLORS[i % BBOX_COLORS.length],
                              }]} />
                            </View>
                            <Text style={styles.detectPct}>{Math.round(d.confidence * 100)}%</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* 메타 정보 */}
                    <View style={styles.detailMeta}>
                      <Text style={styles.detailMetaText}>
                        📅 {new Date(selectedItem.createdAt).toLocaleString('ko-KR')}
                      </Text>
                      <Text style={styles.detailMetaText}>
                        📍 {selectedItem.latitude.toFixed(6)}, {selectedItem.longitude.toFixed(6)}
                      </Text>
                    </View>
                  </>
                );
              })()}
            </View>
          </View>
        </Modal>

      {/* 다중 감지 레이블 선택 모달 */}
      <Modal
        visible={!!labelPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setLabelPicker(null)}
      >
        <View style={styles.detailOverlay}>
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>어떤 장애물인가요?</Text>
              <TouchableOpacity onPress={() => setLabelPicker(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              AI가 여러 객체를 감지했습니다. 실제 장애물을 선택해주세요.
            </Text>
            {labelPicker?.detections.map((d, i) => (
              <TouchableOpacity
                key={i}
                style={styles.pickerItem}
                activeOpacity={0.75}
                onPress={async () => {
                  if (!labelPicker) return;
                  try {
                    await apiUpdateObstacleLabel(labelPicker.obstacleId, d.label);
                  } catch { /* 실패해도 저장은 완료된 상태 */ }
                  setLabelPicker(null);
                  loadListData(true);
                  const labelKo = LABEL_KO[d.label] ?? d.label;
                  Alert.alert(
                    '저장 완료',
                    `장애물 정보가 저장되었습니다.\n\n🤖 AI 감지: ${labelKo} (신뢰도 ${Math.round(d.confidence * 100)}%)`,
                  );
                }}
              >
                <View style={[styles.detectDot, { backgroundColor: BBOX_COLORS[i % BBOX_COLORS.length] }]} />
                <Text style={styles.pickerLabel}>{LABEL_KO[d.label] ?? d.label}</Text>
                <View style={styles.detectBar}>
                  <View style={[styles.detectBarFill, {
                    width: `${Math.round(d.confidence * 100)}%` as any,
                    backgroundColor: BBOX_COLORS[i % BBOX_COLORS.length],
                  }]} />
                </View>
                <Text style={styles.detectPct}>{Math.round(d.confidence * 100)}%</Text>
                <MaterialIcons name="chevron-right" size={18} color="#ccc" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.pickerSkip}
              onPress={() => {
                setLabelPicker(null);
                loadListData(true);
                Alert.alert('저장 완료', '장애물 정보가 저장되었습니다.');
              }}
            >
              <Text style={styles.pickerSkipText}>건너뛰기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
          <TouchableOpacity style={styles.cameraGalleryBtn} onPress={pickFromGallery} activeOpacity={0.8}>
            <MaterialIcons name="photo-library" size={28} color="#fff" />
            <Text style={styles.cameraGalleryText}>갤러리</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shutterButton} onPress={takePicture} activeOpacity={0.8}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
          <View style={styles.cameraGalleryBtn} />
        </View>
      </View>
    );
  }

  // ── 미리보기 화면 ───────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.fullScreen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {capturedUri ? (
        <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      <View style={styles.previewOverlay} />
      <SafeAreaView style={styles.previewContent}>
        <Text style={styles.previewTitle}>{photoSource === 'gallery' ? '갤러리 사진' : '촬영된 사진'}</Text>
        <Text style={styles.previewSub}>
          {photoSource === 'gallery' && exifCoords
            ? `이 사진을 저장하시겠습니까?\n\n📍 사진의 GPS 정보로 위치가 기록됩니다.\n🤖 AI가 자동으로 장애물을 분석합니다.`
            : `이 사진을 저장하시겠습니까?\n저장 시 현재 위치와 날짜가 함께 기록되며\nAI가 자동으로 장애물을 분석합니다.`
          }
        </Text>
        <View style={styles.manualLabelWrap}>
          {analyzing
            ? <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
            : <MaterialIcons name="label-outline" size={18} color="rgba(255,255,255,0.7)" />
          }
          <TextInput
            style={styles.manualLabelInput}
            placeholder={analyzing ? 'AI 분석 중...' : '장애물 이름 입력 (선택)'}
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={manualLabel}
            onChangeText={setManualLabel}
            maxLength={50}
            returnKeyType="done"
            editable={!analyzing}
          />
        </View>
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
            disabled={saving || analyzing}
          >
            {saving || analyzing ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.previewBtnText}>{saving ? '저장 중...' : '분석 중...'}</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="save" size={20} color="#fff" />
                <Text style={styles.previewBtnText}>저장하기</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
  leaderTitle: { fontSize: 16, fontWeight: 'bold', color: '#222', marginBottom: 12 },
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
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  loginPrompt: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  loginPromptText: { fontSize: 13, color: '#aaa', textAlign: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 13, color: '#aaa' },
  obstacleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
    paddingRight: 10,
  },
  thumbWrap: { position: 'relative', width: 90, height: 90 },
  obstacleThumb: { width: 90, height: 90, backgroundColor: '#eee' },
  aiThumbBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FF5722',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  aiThumbBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  obstacleInfo: { flex: 1, padding: 12, justifyContent: 'center', gap: 3 },
  obstacleDate: { fontSize: 13, fontWeight: '600', color: '#333' },
  obstacleCoords: { fontSize: 11, color: '#999' },
  aiLabelRow: {
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  aiLabelText: { fontSize: 11, color: '#E65100', fontWeight: '600' },
  obstacleVotes: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  obstacleVoteText: { fontSize: 12, color: '#555', fontWeight: '600' },
  moreDetectText: { fontSize: 11, color: '#9C27B0', fontWeight: '600' },

  // FAB
  fabRow: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fabSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#555',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 30,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabSecondaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  fab: {
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

  // 상세 모달
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  detailCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '90%',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  detailImgWrap: {
    alignSelf: 'center',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#eee',
  },
  noAiOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  noAiText: { color: '#fff', fontSize: 11 },

  // 감지 목록
  detectList: { marginBottom: 12 },
  detectListTitle: { fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8 },
  detectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  detectDot: { width: 10, height: 10, borderRadius: 5 },
  detectLabel: { fontSize: 13, color: '#333', width: 80 },
  detectBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  detectBarFill: { height: 6, borderRadius: 3 },
  detectPct: { fontSize: 12, color: '#666', width: 32, textAlign: 'right' },

  detailMeta: { gap: 4, marginTop: 4 },
  detailMetaText: { fontSize: 12, color: '#999' },

  // 레이블 선택 모달
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  pickerLabel: { fontSize: 15, fontWeight: '600', color: '#222', width: 90 },
  pickerSkip: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
  },
  pickerSkipText: { fontSize: 14, color: '#888', fontWeight: '500' },

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
  },
  cameraGalleryBtn: {
    width: 60,
    alignItems: 'center',
    gap: 4,
  },
  cameraGalleryText: { color: 'rgba(255,255,255,0.85)', fontSize: 11 },
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
  manualLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  manualLabelInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    padding: 0,
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
