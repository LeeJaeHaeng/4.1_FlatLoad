import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ActivityIndicator,
  Modal, Image, Alert, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllObstaclesWithBase64, ObstacleRecord, castVote, getUserVote } from '../utils/database';
import { useAuth } from '../context/AuthContext';

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;

function buildMapHTML(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 100vw; height: 100vh; overflow: hidden; }
    #map { width: 100%; height: 100%; }
    .leaflet-control-attribution { font-size: 9px; }
    .obstacle-icon img {
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 3px solid #FF5722;
      object-fit: cover;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var accuracyCircle = null;
    var currentHeading = 0;
    var hasHeading = false;

    function buildLocationIcon(heading, showHeading) {
      var svg = '<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">';
      if (showHeading) {
        svg += '<g transform="rotate(' + heading + ', 40, 40)">'
          + '<path d="M40,40 L23,10 A 30 30 0 0 1 57,10 Z" fill="rgba(66,133,244,0.25)" stroke="rgba(66,133,244,0.6)" stroke-width="1" stroke-linejoin="round"/>'
          + '</g>';
      }
      svg += '<circle cx="40" cy="40" r="10" fill="#4285F4" stroke="white" stroke-width="3"/>'
        + '</svg>';
      return L.divIcon({
        html: svg,
        className: '',
        iconSize: [80, 80],
        iconAnchor: [40, 40]
      });
    }

    var marker = L.marker([${lat}, ${lng}], {
      icon: buildLocationIcon(0, false),
      zIndexOffset: 1000
    }).addTo(map);

    var obstacleMarkers = {};

    function updateLocation(lat, lng, accuracy) {
      marker.setLatLng([lat, lng]);
      if (accuracyCircle) {
        map.removeLayer(accuracyCircle);
      }
      if (accuracy && accuracy < 500) {
        accuracyCircle = L.circle([lat, lng], {
          radius: accuracy,
          color: '#4285F4',
          fillColor: '#4285F4',
          fillOpacity: 0.08,
          weight: 1
        }).addTo(map);
      }
    }

    function updateHeading(heading) {
      currentHeading = heading;
      hasHeading = true;
      marker.setIcon(buildLocationIcon(currentHeading, true));
    }

    function flyToLocation(lat, lng) {
      map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
    }

    function addObstacleMarker(id, lat, lng, photoUri, createdAt) {
      if (obstacleMarkers[id]) {
        map.removeLayer(obstacleMarkers[id]);
      }

      var iconHtml = '<div style="position:relative;width:50px;height:60px;">' +
        '<div style="position:absolute;top:0;left:3px;width:44px;height:44px;border-radius:50%;border:3px solid #FF5722;overflow:hidden;background:#eee;">' +
        '<img src="' + photoUri + '" style="width:100%;height:100%;object-fit:cover;" />' +
        '</div>' +
        '<div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:14px solid #FF5722;"></div>' +
        '</div>';

      var icon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [50, 60],
        iconAnchor: [25, 60],
        popupAnchor: [0, -62]
      });

      var m = L.marker([lat, lng], { icon: icon }).addTo(map);
      m.on('click', function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'obstacleClick',
          id: id,
          lat: lat,
          lng: lng,
          photoUri: photoUri,
          createdAt: createdAt
        }));
      });
      obstacleMarkers[id] = m;
    }

    function clearObstacleMarkers() {
      Object.values(obstacleMarkers).forEach(function(m) {
        map.removeLayer(m);
      });
      obstacleMarkers = {};
    }

    document.addEventListener('message', function(e) {
      handleMessage(e.data);
    });
    window.addEventListener('message', function(e) {
      handleMessage(e.data);
    });

    function handleMessage(data) {
      try {
        var msg = JSON.parse(data);
        if (msg.type === 'updateLocation') {
          updateLocation(msg.lat, msg.lng, msg.accuracy);
        } else if (msg.type === 'updateHeading') {
          updateHeading(msg.heading);
        } else if (msg.type === 'flyTo') {
          flyToLocation(msg.lat, msg.lng);
        } else if (msg.type === 'setObstacles') {
          clearObstacleMarkers();
          msg.obstacles.forEach(function(o) {
            addObstacleMarker(o.id, o.latitude, o.longitude, o.photoUri, o.createdAt);
          });
        }
      } catch(e) {}
    }
  </script>
</body>
</html>`;
}

export default function MapScreen({ navigation }: any) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [obstacles, setObstacles] = useState<(ObstacleRecord & { photoBase64: string })[]>([]);
  const [selectedObstacle, setSelectedObstacle] = useState<ObstacleRecord | null>(null);
  const [voteState, setVoteState] = useState<{ likes: number; dislikes: number; userVote: 'like' | 'dislike' | null } | null>(null);
  const webViewRef = useRef<WebView>(null);

  const showWip = () => Alert.alert('알림', '아직 개발중입니다.');

  useEffect(() => {
    let posSubscription: Location.LocationSubscription | null = null;
    let headingSubscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('위치 접근 권한이 거부되었습니다.');
        setLoading(false);
        return;
      }

      try {
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 0,
        });
        setLocation({
          lat: initial.coords.latitude,
          lng: initial.coords.longitude,
          accuracy: initial.coords.accuracy ?? undefined,
        });
      } catch {
        // 초기 위치 실패해도 계속 진행
      } finally {
        setLoading(false);
      }

      posSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        (loc) => {
          setLocation({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? undefined,
          });
        }
      );

      try {
        headingSubscription = await Location.watchHeadingAsync((h) => {
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setHeading(deg);
        });
      } catch {
        // 나침반 미지원 기기에서는 방향 표시 없이 동작
      }
    })();

    return () => {
      posSubscription?.remove();
      headingSubscription?.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      getAllObstaclesWithBase64().then(setObstacles).catch(console.error);
    }, [])
  );

  useEffect(() => {
    if (!selectedObstacle) { setVoteState(null); return; }
    const userId = user?.uid ?? '';
    Promise.all([
      getUserVote(selectedObstacle.id, userId),
    ]).then(([userVote]) => {
      setVoteState({
        likes: selectedObstacle.likes,
        dislikes: selectedObstacle.dislikes,
        userVote,
      });
    });
  }, [selectedObstacle, user]);

  const handleVote = async (voteType: 'like' | 'dislike') => {
    if (!selectedObstacle || !user) return;
    const result = await castVote(selectedObstacle.id, user.uid, voteType);
    setVoteState(result);
    setObstacles(prev =>
      prev.map(o => o.id === selectedObstacle.id
        ? { ...o, likes: result.likes, dislikes: result.dislikes }
        : o
      )
    );
  };

  useEffect(() => {
    if (!mapReady || !location) return;
    webViewRef.current?.injectJavaScript(`
      updateLocation(${location.lat}, ${location.lng}, ${location.accuracy ?? 0});
      true;
    `);
  }, [location, mapReady]);

  useEffect(() => {
    if (!mapReady || heading === null) return;
    webViewRef.current?.injectJavaScript(`
      updateHeading(${heading});
      true;
    `);
  }, [heading, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    webViewRef.current?.injectJavaScript(`
      (function() {
        var obs = ${JSON.stringify(obstacles.map(o => ({
          id: o.id,
          latitude: o.latitude,
          longitude: o.longitude,
          photoUri: o.photoBase64 || o.photoUri,
          createdAt: o.createdAt,
        })))};
        handleMessage(JSON.stringify({ type: 'setObstacles', obstacles: obs }));
      })();
      true;
    `);
  }, [obstacles, mapReady]);

  const flyToCurrentLocation = () => {
    if (!location) return;
    webViewRef.current?.injectJavaScript(`
      flyToLocation(${location.lat}, ${location.lng});
      true;
    `);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>위치 정보를 가져오는 중...</Text>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorMsg}</Text>
      </View>
    );
  }

  const initLat = location?.lat ?? DEFAULT_LAT;
  const initLng = location?.lng ?? DEFAULT_LNG;

  return (
    <View style={styles.container}>
      {/* 지도 (전체 화면) */}
      <WebView
        ref={webViewRef}
        style={StyleSheet.absoluteFill}
        source={{ html: buildMapHTML(initLat, initLng) }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onLoad={() => setMapReady(true)}
        onError={() => setErrorMsg('지도를 불러오는 데 실패했습니다.')}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.type === 'obstacleClick') {
              const found = obstacles.find(o => o.id === msg.id);
              if (found) setSelectedObstacle(found);
            }
          } catch {}
        }}
      />

      {/* 상단 오버레이: 검색창 + 필터 */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchRow}>
          <TouchableOpacity style={styles.searchBar} onPress={showWip} activeOpacity={0.8}>
            <MaterialIcons name="search" size={20} color="#aaa" />
            <Text style={styles.searchPlaceholder}>목적지 검색</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editButton} onPress={showWip} activeOpacity={0.8}>
            <MaterialIcons name="edit-note" size={26} color="#333" />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
          style={styles.filterScroll}
        >
          <TouchableOpacity style={styles.filterChip} onPress={showWip} activeOpacity={0.8}>
            <MaterialIcons name="tune" size={14} color="#555" />
            <Text style={styles.filterChipText}> 필터</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterChip, styles.filterChipActive]} onPress={showWip} activeOpacity={0.8}>
            <Text style={styles.filterChipActiveText}>✈ 경사로</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={showWip} activeOpacity={0.8}>
            <MaterialIcons name="elevator" size={14} color="#555" />
            <Text style={styles.filterChipText}> 엘리베이터</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={showWip} activeOpacity={0.8}>
            <MaterialIcons name="wc" size={14} color="#555" />
            <Text style={styles.filterChipText}> 장애인화장실</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 우측 플로팅 버튼들 */}
      <View style={styles.rightButtons}>
        <TouchableOpacity
          style={styles.mapIconBtn}
          onPress={flyToCurrentLocation}
          activeOpacity={0.8}
        >
          <MaterialIcons name="my-location" size={22} color={location ? '#333' : '#aaa'} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapIconBtn} onPress={showWip} activeOpacity={0.8}>
          <MaterialIcons name="layers" size={22} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mapIconBtn}
          onPress={() => navigation.navigate('기여하기')}
          activeOpacity={0.8}
        >
          <MaterialIcons name="add" size={22} color="#333" />
        </TouchableOpacity>
      </View>


      {/* 하단 경로 시트 */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.dragHandle} />
        <View style={styles.routeRow}>
          <View style={styles.routeIconBox}>
            <Text style={styles.routeEmoji}>🚀</Text>
          </View>
          <View style={styles.routeTextBox}>
            <Text style={styles.routeLabel}>추천 경로</Text>
            <Text style={styles.routeTitle}>천안 안전 경로</Text>
            <Text style={styles.routeSub}>위험구간 2개 · 안전도 높음</Text>
          </View>
        </View>
        <View style={styles.routeBtnRow}>
          <TouchableOpacity style={styles.normalBtn} onPress={showWip} activeOpacity={0.8}>
            <Text style={styles.normalBtnText}>일반 경로</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.safeBtn} onPress={showWip} activeOpacity={0.8}>
            <Text style={styles.safeBtnText}>안전 길찾기 시작</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 장애물 상세 모달 */}
      {selectedObstacle && (
        <Modal
          transparent
          animationType="slide"
          visible={!!selectedObstacle}
          onRequestClose={() => setSelectedObstacle(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>장애물 정보</Text>
              <Image
                source={{ uri: selectedObstacle.photoUri }}
                style={styles.modalImage}
                resizeMode="cover"
              />
              <View style={styles.modalInfo}>
                <Text style={styles.modalLabel}>촬영 일시</Text>
                <Text style={styles.modalValue}>
                  {new Date(selectedObstacle.createdAt).toLocaleString('ko-KR')}
                </Text>
                <Text style={styles.modalLabel}>위치 좌표</Text>
                <Text style={styles.modalValue}>
                  {`위도 ${selectedObstacle.latitude.toFixed(6)}`}{'\n'}
                  {`경도 ${selectedObstacle.longitude.toFixed(6)}`}
                </Text>
                <Text style={styles.modalLabel}>기여자</Text>
                <Text style={styles.modalValue}>
                  {selectedObstacle.displayName
                    ? `${selectedObstacle.displayName} (${selectedObstacle.userEmail})`
                    : selectedObstacle.userEmail || '익명'}
                </Text>
              </View>
              <View style={styles.voteRow}>
                <TouchableOpacity
                  style={[styles.voteButton, voteState?.userVote === 'like' && styles.voteButtonLiked]}
                  onPress={() => handleVote('like')}
                  disabled={!user}
                >
                  <MaterialIcons name="thumb-up" size={20} color={voteState?.userVote === 'like' ? '#fff' : '#4285F4'} />
                  <Text style={[styles.voteCount, voteState?.userVote === 'like' && styles.voteCountActive]}>
                    {voteState?.likes ?? selectedObstacle.likes}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.voteButton, voteState?.userVote === 'dislike' && styles.voteButtonDisliked]}
                  onPress={() => handleVote('dislike')}
                  disabled={!user}
                >
                  <MaterialIcons name="thumb-down" size={20} color={voteState?.userVote === 'dislike' ? '#fff' : '#e53935'} />
                  <Text style={[styles.voteCount, voteState?.userVote === 'dislike' && styles.voteCountActive]}>
                    {voteState?.dislikes ?? selectedObstacle.dislikes}
                  </Text>
                </TouchableOpacity>
              </View>
              {!user && (
                <Text style={styles.voteLoginHint}>로그인 후 평가할 수 있습니다</Text>
              )}
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setSelectedObstacle(null)}
              >
                <Text style={styles.modalCloseText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#e8e8e8',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#e53935',
    textAlign: 'center',
    paddingHorizontal: 24,
  },

  /* 상단 오버레이 */
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: 'transparent',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    gap: 8,
  },
  searchPlaceholder: {
    fontSize: 15,
    color: '#aaa',
    flex: 1,
  },
  editButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterContent: {
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  filterChipActive: {
    backgroundColor: '#F5A623',
  },
  filterChipText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  filterChipActiveText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },

  /* 우측 버튼 */
  rightButtons: {
    position: 'absolute',
    right: 16,
    bottom: 210,
    gap: 8,
  },
  mapIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },

  /* 하단 경로 시트 */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e0e0e0',
    alignSelf: 'center',
    marginBottom: 14,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  routeIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeEmoji: {
    fontSize: 26,
  },
  routeTextBox: {
    flex: 1,
    gap: 2,
  },
  routeLabel: {
    fontSize: 12,
    color: '#F5A623',
    fontWeight: '600',
  },
  routeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  routeSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  routeBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  normalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  normalBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  safeBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
  },
  safeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  /* 장애물 모달 */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 14,
    textAlign: 'center',
  },
  modalImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  modalInfo: {
    marginTop: 16,
    gap: 4,
  },
  modalLabel: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  modalValue: {
    fontSize: 15,
    color: '#333',
  },
  voteRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  voteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  voteButtonLiked: {
    backgroundColor: '#4285F4',
    borderColor: '#4285F4',
  },
  voteButtonDisliked: {
    backgroundColor: '#e53935',
    borderColor: '#e53935',
  },
  voteCount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  voteCountActive: {
    color: '#fff',
  },
  voteLoginHint: {
    textAlign: 'center',
    fontSize: 12,
    color: '#bbb',
    marginTop: 8,
  },
  modalCloseButton: {
    marginTop: 16,
    backgroundColor: '#4285F4',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
