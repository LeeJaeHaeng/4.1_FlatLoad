import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ActivityIndicator,
  Modal, Image, Alert, ScrollView, TextInput, FlatList, Keyboard,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllObstaclesWithBase64, ObstacleRecord, castVote, getUserVote } from '../utils/database';
import { apiGetObstacles, apiVoteObstacle, apiGetUserVote } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;

interface ManeuverStep {
  type: number;
  instruction: string;
  length: number;   // km
  beginShapeIndex: number;
  lat: number;
  lng: number;
}

const MANEUVER_ICONS: Record<number, string> = {
  1:'↑', 7:'↑', 8:'↑', 22:'↑',
  2:'↗', 9:'↗', 17:'↗',
  10:'→', 18:'→',
  11:'↘', 12:'↩',
  13:'↪', 14:'↙',
  15:'←', 16:'↖', 3:'↖', 19:'↖',
  4:'🏁', 5:'🏁', 6:'🏁',
  39:'🛗', 40:'🚫',
};
const MANEUVER_LABELS: Record<number, string> = {
  1:'직진', 7:'직진', 8:'계속 직진', 22:'직진',
  2:'우측 방향', 9:'우측 방향', 17:'우측 방향',
  10:'우회전', 18:'우회전',
  11:'급우회전', 12:'U턴',
  13:'U턴', 14:'급좌회전',
  15:'좌회전', 16:'좌측 방향', 3:'좌측 방향', 19:'좌측 방향',
  4:'목적지 도착', 5:'목적지 도착', 6:'목적지 도착',
  39:'엘리베이터 이용', 40:'⚠️ 계단 (통행 주의)',
};
const getManeuverIcon = (t: number) => MANEUVER_ICONS[t] ?? '↑';
const getManeuverLabel = (t: number) => MANEUVER_LABELS[t] ?? '계속 직진';
const fmtDist = (m: number) => m >= 1000 ? `${(m/1000).toFixed(1)}km` : `${Math.round(m)}m`;

const KAKAO_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_KEY ?? '';

// 세 필터 모두 Kakao 로컬 검색 사용
// 경사로: 단일 키워드가 없어 여러 키워드를 병렬 조회 후 합산
type FilterCfg =
  | { apiType: 'kakao'; facilityType: string; keywords: string[] };

const FILTER_CFG: Record<string, FilterCfg> = {
  '경사로': {
    apiType: 'kakao',
    facilityType: 'ramp',
    keywords: ['무장애', '배리어프리', '휠체어경사로'],
  },
  '엘리베이터': {
    apiType: 'kakao',
    facilityType: 'elevator',
    keywords: ['엘리베이터'],
  },
  '장애인화장실': {
    apiType: 'kakao',
    facilityType: 'toilet',
    keywords: ['장애인화장실'],
  },
};

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
    var routeLayer = null;
    var destMarker = null;

    // ── 시설 마커 ───────────────────────────────────────────────
    var facilityMarkers = [];
    function clearFacilityMarkers(type) {
      if (!type) {
        facilityMarkers.forEach(function(m) { map.removeLayer(m.marker); });
        facilityMarkers = [];
      } else {
        facilityMarkers = facilityMarkers.filter(function(m) {
          if (m.type === type) { map.removeLayer(m.marker); return false; }
          return true;
        });
      }
    }
    function addFacilityMarker(lat, lng, type) {
      var cfg = { elevator:{e:'🛗',c:'#2196F3'}, ramp:{e:'♿',c:'#4CAF50'}, toilet:{e:'🚻',c:'#9C27B0'}, slope:{e:'⚠️',c:'#FF5722'} }[type] || {e:'📍',c:'#607D8B'};
      var icon = L.divIcon({
        html: '<div style="width:34px;height:34px;border-radius:50%;background:'+cfg.c+';display:flex;align-items:center;justify-content:center;font-size:17px;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);">'+cfg.e+'</div>',
        className:'', iconSize:[34,34], iconAnchor:[17,17]
      });
      facilityMarkers.push({ marker: L.marker([lat,lng],{icon:icon}).addTo(map), type: type });
    }

    // ── 경로 회전 마커 ──────────────────────────────────────────
    var maneuverMarkers = [];
    function clearManeuverMarkers() {
      maneuverMarkers.forEach(function(m){ map.removeLayer(m); });
      maneuverMarkers = [];
    }
    function addManeuverMarker(lat, lng, arrow, distStr) {
      var icon = L.divIcon({
        html: '<div style="background:#1a1a1a;color:white;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 5px rgba(0,0,0,0.4);">'+arrow+' '+distStr+'</div>',
        className:'', iconAnchor:[0,10]
      });
      maneuverMarkers.push(L.marker([lat,lng],{icon:icon}).addTo(map));
    }

    function drawRoute(coords, color) {
      if (routeLayer) map.removeLayer(routeLayer);
      var latlngs = coords.map(function(c) { return [c[1], c[0]]; });
      routeLayer = L.polyline(latlngs, {
        color: color || '#4285F4',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [80, 80] });
    }

    function clearRoute() {
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
      if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    }

    function addDestMarker(lat, lng) {
      if (destMarker) map.removeLayer(destMarker);
      var icon = L.divIcon({
        html: '<div style="width:18px;height:18px;border-radius:50%;background:#FF5722;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.4);"></div>',
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      destMarker = L.marker([lat, lng], { icon: icon }).addTo(map);
    }

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
        } else if (msg.type === 'drawRoute') {
          drawRoute(msg.coords, msg.color);
        } else if (msg.type === 'clearRoute') {
          clearRoute();
          clearManeuverMarkers();
          clearFacilityMarkers('slope');
        } else if (msg.type === 'addDestMarker') {
          addDestMarker(msg.lat, msg.lng);
        } else if (msg.type === 'addFacilityMarker') {
          addFacilityMarker(msg.lat, msg.lng, msg.facilityType);
        } else if (msg.type === 'clearFacilityMarkers') {
          clearFacilityMarkers(msg.facilityType || null);
        } else if (msg.type === 'addManeuverMarker') {
          addManeuverMarker(msg.lat, msg.lng, msg.arrow, msg.distStr);
        } else if (msg.type === 'clearManeuverMarkers') {
          clearManeuverMarkers();
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

  // 길찾기 상태
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string; mode: 'safe' | 'normal'; obstacleCount: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // 실시간 내비게이션 상태
  const [isNavigating, setIsNavigating] = useState(false);
  const [maneuvers, setManeuvers] = useState<ManeuverStep[]>([]);
  const [currentManeuverIdx, setCurrentManeuverIdx] = useState(0);
  const [routePoints, setRoutePoints] = useState<[number, number][]>([]);
  const [distToNextTurn, setDistToNextTurn] = useState(0);
  const [isRerouting, setIsRerouting] = useState(false);

  // 필터 상태
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [filterLoading, setFilterLoading] = useState<string | null>(null);

  // 내비게이션 업데이트 함수를 ref에 저장 (stale closure 방지)
  const navUpdateRef = useRef<(lat: number, lng: number) => void>(() => {});
  useEffect(() => {
    navUpdateRef.current = (userLat: number, userLng: number) => {
      if (!isNavigating || !routePoints.length || !maneuvers.length) return;

      // 가장 가까운 경로 포인트 탐색
      let minDist = Infinity, minIdx = 0;
      routePoints.forEach(([lat, lng], i) => {
        const d = haversine(userLat, userLng, lat, lng);
        if (d < minDist) { minDist = d; minIdx = i; }
      });

      // 80m 이상 이탈 시 재탐색
      if (minDist > 80 && !isRerouting && destCoords) {
        setIsRerouting(true);
        fetchRoute(userLat, userLng, destCoords.lat, destCoords.lng, 'safe')
          .finally(() => setIsRerouting(false));
        return;
      }

      // 현재 단계 계산
      let mIdx = 0;
      for (let i = maneuvers.length - 1; i >= 0; i--) {
        if (minIdx >= maneuvers[i].beginShapeIndex) { mIdx = i; break; }
      }
      setCurrentManeuverIdx(mIdx);

      // 다음 회전까지 거리
      if (mIdx + 1 < maneuvers.length) {
        setDistToNextTurn(haversine(userLat, userLng, maneuvers[mIdx + 1].lat, maneuvers[mIdx + 1].lng));
      }

      // 내비 중 지도 사용자 중심 유지
      webViewRef.current?.injectJavaScript(
        `map.setView([${userLat},${userLng}], 18, {animate:true}); true;`
      );
    };
  }, [isNavigating, routePoints, maneuvers, isRerouting, destCoords]);

  const searchDestination = async () => {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=6&countrycodes=kr&accept-language=ko`,
        { headers: { 'User-Agent': 'FlatRoadApp/1.0' } }
      );
      const data = await res.json();
      setSearchResults(data);
    } catch {
      Alert.alert('오류', '검색 중 문제가 발생했습니다.');
    } finally {
      setSearching(false);
    }
  };

  // Valhalla 폴리라인 디코더 (precision=6)
  const decodePolyline = (encoded: string): [number, number][] => {
    const points: [number, number][] = [];
    let idx = 0, lat = 0, lng = 0;
    while (idx < encoded.length) {
      let shift = 0, result = 0, b;
      do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : result >> 1;
      shift = 0; result = 0;
      do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : result >> 1;
      points.push([lat / 1e6, lng / 1e6]);
    }
    return points;
  };

  // 두 좌표 간 거리(m) 계산 (Haversine)
  const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // 경로 근처 장애물 개수 계산 (50m 이내)
  const countObstaclesNearRoute = (routePoints: [number, number][]): number => {
    return obstacles.filter(obs =>
      routePoints.some(([lat, lng]) => haversine(lat, lng, obs.latitude, obs.longitude) < 50)
    ).length;
  };

  const fetchRoute = async (
    fromLat: number, fromLng: number,
    toLat: number, toLng: number,
    mode: 'safe' | 'normal'
  ) => {
    setRouteLoading(true);
    try {
      if (mode === 'safe') {
        // ── Valhalla 전동휠체어 경로 (인도·경사·노면·폭 고려) ──────
        const body = {
          locations: [
            { lon: fromLng, lat: fromLat },
            { lon: toLng, lat: toLat },
          ],
          costing: 'wheelchair',
          costing_options: {
            wheelchair: {
              max_distance: 20000,
              walking_speed: 4.0,
              // 계단 완전 회피
              step_penalty: 300,
              // 좁은 골목 회피
              alley_factor: 5.0,
              // 인도·보행자 도로 우선
              walkway_factor: 0.8,
              use_living_streets: 0.3,
              // 경사도 3% 이상 경로 패널티
              max_hiking_difficulty: 1,
            },
          },
          units: 'km',
        };
        const res = await fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error || !data.trip?.legs?.length) {
          // Valhalla 실패 시 OSRM foot 폴백
          await fetchOsrmRoute(fromLat, fromLng, toLat, toLng, 'foot', '#4285F4', 'safe');
          return;
        }
        const leg = data.trip.legs[0];
        const latlngs = decodePolyline(leg.shape);           // [[lat,lng],...]
        const geoCoords = latlngs.map(([la, lo]) => [lo, la]); // GeoJSON [lng,lat]
        const distKm = data.trip.summary.length as number;
        const durSec = data.trip.summary.time as number;
        const distStr = distKm >= 1 ? `${distKm.toFixed(1)}km` : `${Math.round(distKm * 1000)}m`;
        const durStr = durSec >= 3600
          ? `${Math.floor(durSec / 3600)}시간 ${Math.floor((durSec % 3600) / 60)}분`
          : `${Math.ceil(durSec / 60)}분`;
        const nearObstacles = countObstaclesNearRoute(latlngs);
        setRouteInfo({ distance: distStr, duration: durStr, mode, obstacleCount: nearObstacles });
        webViewRef.current?.injectJavaScript(
          `drawRoute(${JSON.stringify(geoCoords)}, '#4285F4'); true;`
        );

        // 회전 지시 파싱
        const parsedManeuvers: ManeuverStep[] = (data.trip.legs[0].maneuvers ?? []).map((m: any) => ({
          type: m.type,
          instruction: m.instruction ?? getManeuverLabel(m.type),
          length: m.length ?? 0,
          beginShapeIndex: m.begin_shape_index ?? 0,
          lat: latlngs[m.begin_shape_index]?.[0] ?? fromLat,
          lng: latlngs[m.begin_shape_index]?.[1] ?? fromLng,
        }));
        setRoutePoints(latlngs);
        setManeuvers(parsedManeuvers);
        setCurrentManeuverIdx(0);
        setDistToNextTurn(parsedManeuvers[1] ? Math.round(parsedManeuvers[0].length * 1000) : 0);

        // 회전 마커 지도에 표시
        webViewRef.current?.injectJavaScript(`clearManeuverMarkers(); true;`);
        parsedManeuvers.slice(0, -1).forEach((step, i) => {
          if (i >= 8) return;
          const arrow = getManeuverIcon(step.type);
          const label = getManeuverLabel(step.type);
          webViewRef.current?.injectJavaScript(
            `addManeuverMarker(${step.lat}, ${step.lng}, '${arrow}', '${label.replace(/'/g, "\\'")}'); true;`
          );
        });

        // 경사·계단 경고 비동기 로드
        fetchSlopeWarnings(latlngs);
      } else {
        // ── 일반 경로: OSRM driving ──────────────────────────────
        await fetchOsrmRoute(fromLat, fromLng, toLat, toLng, 'driving', '#888888', 'normal');
      }
    } catch {
      Alert.alert('오류', '경로 계산 중 문제가 발생했습니다.');
    } finally {
      setRouteLoading(false);
    }
  };

  const fetchOsrmRoute = async (
    fromLat: number, fromLng: number,
    toLat: number, toLng: number,
    profile: string, color: string, mode: 'safe' | 'normal'
  ) => {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/${profile}/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&overview=full`
    );
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) {
      Alert.alert('오류', '경로를 찾을 수 없습니다.');
      return;
    }
    const route = data.routes[0];
    const dist = route.distance as number;
    const dur = route.duration as number;
    const distStr = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`;
    const durStr = dur >= 3600
      ? `${Math.floor(dur / 3600)}시간 ${Math.floor((dur % 3600) / 60)}분`
      : `${Math.ceil(dur / 60)}분`;
    const latlngs: [number, number][] = route.geometry.coordinates.map(([lo, la]: number[]) => [la, lo]);
    const nearObstacles = countObstaclesNearRoute(latlngs);
    setRouteInfo({ distance: distStr, duration: durStr, mode, obstacleCount: nearObstacles });
    webViewRef.current?.injectJavaScript(
      `drawRoute(${JSON.stringify(route.geometry.coordinates)}, '${color}'); true;`
    );
  };

  const fetchSlopeWarnings = async (routePts: [number, number][]) => {
    if (!routePts.length) return;
    const lats = routePts.map(p => p[0]);
    const lngs = routePts.map(p => p[1]);
    const bbox = `${Math.min(...lats) - 0.001},${Math.min(...lngs) - 0.001},${Math.max(...lats) + 0.001},${Math.max(...lngs) + 0.001}`;
    try {
      const query = `[out:json][timeout:15];(node["highway"="steps"](${bbox});way["highway"="steps"](${bbox});node["incline"~"steep"](${bbox}););out center;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      const data = await res.json();
      (data.elements ?? []).slice(0, 30).forEach((el: any) => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat && lng && routePts.some(([rlat, rlng]) => haversine(lat, lng, rlat, rlng) < 80)) {
          webViewRef.current?.injectJavaScript(`addFacilityMarker(${lat}, ${lng}, 'slope'); true;`);
        }
      });
    } catch { /* 경사 데이터 로드 실패 무시 */ }
  };

  const toggleFilter = async (filterName: string) => {
    const cfg = FILTER_CFG[filterName];
    if (!cfg) return;

    // 이미 활성 → 마커 제거 후 비활성화
    if (activeFilters.has(filterName)) {
      setActiveFilters(prev => { const n = new Set(prev); n.delete(filterName); return n; });
      webViewRef.current?.injectJavaScript(`clearFacilityMarkers('${cfg.facilityType}'); true;`);
      return;
    }

    if (!location) {
      Alert.alert('알림', '위치 정보를 가져오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setFilterLoading(filterName);
    try {
      let count = 0;

      // ── Kakao 로컬 검색 ────────────────────────────────────────────
      if (!KAKAO_KEY || KAKAO_KEY === '여기에_카카오_REST_API_키_입력') {
        Alert.alert('설정 필요', '.env 파일에 EXPO_PUBLIC_KAKAO_REST_KEY를 입력해주세요.');
        return;
      }

      // 중복 좌표 제거용 Set
      const seen = new Set<string>();

      // 키워드별 순차 조회 (경사로는 3개 키워드)
      for (const keyword of cfg.keywords) {
        for (let page = 1; page <= 3; page++) {
          const url =
            `https://dapi.kakao.com/v2/local/search/keyword.json` +
            `?query=${encodeURIComponent(keyword)}` +
            `&x=${location.lng}&y=${location.lat}` +
            `&radius=3000&size=15&page=${page}`;
          const res = await fetch(url, {
            headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
          });
          if (!res.ok) throw new Error(`Kakao API 오류: ${res.status}`);
          const data = await res.json();
          const docs: any[] = data.documents ?? [];
          docs.forEach((doc: any) => {
            const lat = parseFloat(doc.y);
            const lng = parseFloat(doc.x);
            const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
            if (lat && lng && !seen.has(key)) {
              seen.add(key);
              webViewRef.current?.injectJavaScript(
                `addFacilityMarker(${lat}, ${lng}, '${cfg.facilityType}'); true;`
              );
              count++;
            }
          });
          if (data.meta?.is_end) break;
        }
      }

      setActiveFilters(prev => new Set([...prev, filterName]));
      if (count === 0) {
        Alert.alert('검색 결과', `주변 ${filterName} 정보가 없습니다.`);
      } else {
        Alert.alert('검색 완료', `주변 ${filterName} ${count}개를 찾았습니다.`);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        Alert.alert('시간 초과', '서버 응답이 너무 늦습니다. 다시 시도해주세요.');
      } else {
        Alert.alert('오류', `${filterName} 정보를 불러오지 못했습니다: ${e?.message ?? ''}`);
      }
    } finally {
      setFilterLoading(null);
    }
  };

  const selectDestination = async (item: { display_name: string; lat: string; lon: string }) => {
    setShowSearch(false);
    setSearchResults([]);
    const shortName = item.display_name.split(',')[0].trim();
    setDestination(shortName);
    const toLat = parseFloat(item.lat);
    const toLng = parseFloat(item.lon);
    setDestCoords({ lat: toLat, lng: toLng });
    setRouteInfo(null);
    webViewRef.current?.injectJavaScript(`addDestMarker(${toLat}, ${toLng}); true;`);
    if (location) {
      await fetchRoute(location.lat, location.lng, toLat, toLng, 'safe');
    }
  };

  const clearDestination = () => {
    setDestination('');
    setDestCoords(null);
    setRouteInfo(null);
    setSearchQuery('');
    webViewRef.current?.injectJavaScript(`clearRoute(); true;`);
  };

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
      // 서버 장애물 우선, 실패 시 로컬 폴백
      apiGetObstacles()
        .then(list => setObstacles(list.map(o => ({ ...o, photoBase64: o.photoUri })) as any))
        .catch(() => getAllObstaclesWithBase64().then(setObstacles).catch(console.error));
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
    navUpdateRef.current(location.lat, location.lng);
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
          <TouchableOpacity
            style={styles.searchBar}
            onPress={() => setShowSearch(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="search" size={20} color="#aaa" />
            {destination ? (
              <Text style={[styles.searchPlaceholder, { color: '#333' }]} numberOfLines={1}>
                {destination}
              </Text>
            ) : (
              <Text style={styles.searchPlaceholder}>목적지 검색</Text>
            )}
            {destination && (
              <TouchableOpacity onPress={clearDestination} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={18} color="#aaa" />
              </TouchableOpacity>
            )}
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
          {(['경사로', '엘리베이터', '장애인화장실'] as const).map((name) => {
            const active = activeFilters.has(name);
            const loading = filterLoading === name;
            return (
              <TouchableOpacity
                key={name}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => toggleFilter(name)}
                activeOpacity={0.8}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator size={12} color={active ? '#fff' : '#555'} />
                  : <Text style={active ? styles.filterChipActiveText : styles.filterChipText}>
                      {name === '경사로' ? '♿ 경사로' : name === '엘리베이터' ? '🛗 엘리베이터' : '🚻 장애인화장실'}
                    </Text>
                }
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* 실시간 내비게이션 패널 */}
      {isNavigating && maneuvers.length > 0 && (
        <View style={[styles.navPanel, { top: insets.top + 8 }]}>
          <View style={styles.navPanelInner}>
            <Text style={styles.navArrow}>{getManeuverIcon(maneuvers[currentManeuverIdx]?.type ?? 1)}</Text>
            <View style={styles.navTextBox}>
              <Text style={styles.navInstruction} numberOfLines={2}>
                {maneuvers[currentManeuverIdx]?.instruction ?? getManeuverLabel(maneuvers[currentManeuverIdx]?.type ?? 1)}
              </Text>
              <Text style={styles.navDist}>{fmtDist(distToNextTurn)}</Text>
            </View>
            <TouchableOpacity
              style={styles.navClose}
              onPress={() => { setIsNavigating(false); setManeuvers([]); setRoutePoints([]); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          {isRerouting && (
            <View style={styles.navReroute}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.navRerouteText}>경로 재탐색 중...</Text>
            </View>
          )}
        </View>
      )}

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
        {routeLoading ? (
          <View style={styles.routeRow}>
            <ActivityIndicator color="#4285F4" />
            <Text style={{ marginLeft: 12, color: '#888', fontSize: 14 }}>경로 계산 중...</Text>
          </View>
        ) : routeInfo ? (
          <View style={styles.routeRow}>
            <View style={styles.routeIconBox}>
              <Text style={styles.routeEmoji}>{routeInfo.mode === 'safe' ? '🚶' : '🚗'}</Text>
            </View>
            <View style={styles.routeTextBox}>
              <Text style={styles.routeLabel}>
                {routeInfo.mode === 'safe' ? '안전 보행 경로' : '일반 경로'}
              </Text>
              <Text style={styles.routeTitle}>{destination}</Text>
              <Text style={styles.routeSub}>
                {routeInfo.distance} · 약 {routeInfo.duration}
                {routeInfo.obstacleCount > 0
                  ? ` · ⚠️ 장애물 ${routeInfo.obstacleCount}개`
                  : ' · ✅ 장애물 없음'}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.routeRow}>
            <View style={styles.routeIconBox}>
              <Text style={styles.routeEmoji}>🗺️</Text>
            </View>
            <View style={styles.routeTextBox}>
              <Text style={styles.routeLabel}>길찾기</Text>
              <Text style={styles.routeTitle}>목적지를 검색하세요</Text>
              <Text style={styles.routeSub}>장애물을 피한 안전 경로를 안내합니다</Text>
            </View>
          </View>
        )}
        <View style={styles.routeBtnRow}>
          <TouchableOpacity
            style={[styles.normalBtn, !destCoords && styles.btnDisabled]}
            onPress={() => {
              if (!destCoords || !location) { setShowSearch(true); return; }
              fetchRoute(location.lat, location.lng, destCoords.lat, destCoords.lng, 'normal');
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.normalBtnText}>일반 경로</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.safeBtn, !destCoords && styles.btnDisabled]}
            onPress={() => {
              if (!destCoords || !location) { setShowSearch(true); return; }
              fetchRoute(location.lat, location.lng, destCoords.lat, destCoords.lng, 'safe');
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.safeBtnText}>안전 길찾기</Text>
          </TouchableOpacity>
        </View>

        {/* 안내 시작 / 안내 종료 */}
        {routeInfo && !isNavigating && maneuvers.length > 0 && (
          <TouchableOpacity
            style={styles.startNavBtn}
            onPress={() => { setIsNavigating(true); setCurrentManeuverIdx(0); }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="navigation" size={18} color="#fff" />
            <Text style={styles.startNavBtnText}>안내 시작</Text>
          </TouchableOpacity>
        )}
        {isNavigating && (
          <TouchableOpacity
            style={styles.stopNavBtn}
            onPress={() => { setIsNavigating(false); setManeuvers([]); setRoutePoints([]); }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="stop" size={18} color="#e53935" />
            <Text style={styles.stopNavBtnText}>안내 종료</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 목적지 검색 모달 */}
      <Modal visible={showSearch} animationType="slide" onRequestClose={() => setShowSearch(false)}>
        <View style={[styles.searchModal, { paddingTop: insets.top + 8 }]}>
          {/* 검색 헤더 */}
          <View style={styles.searchModalHeader}>
            <TouchableOpacity onPress={() => setShowSearch(false)} style={styles.searchModalBack}>
              <MaterialIcons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <TextInput
              style={styles.searchModalInput}
              placeholder="목적지 검색 (예: 천안역)"
              placeholderTextColor="#bbb"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={searchDestination}
              autoFocus
              returnKeyType="search"
            />
            <TouchableOpacity onPress={searchDestination} style={styles.searchModalBtn}>
              <MaterialIcons name="search" size={24} color="#4285F4" />
            </TouchableOpacity>
          </View>

          {searching ? (
            <ActivityIndicator color="#4285F4" style={{ marginTop: 40 }} />
          ) : searchResults.length === 0 ? (
            <View style={styles.searchEmpty}>
              <MaterialIcons name="place" size={48} color="#e0e0e0" />
              <Text style={styles.searchEmptyText}>
                {searchQuery ? '검색 결과가 없습니다' : '목적지를 검색해보세요'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => selectDestination(item)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="place" size={20} color="#FF5722" style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultMain} numberOfLines={1}>
                      {item.display_name.split(',')[0].trim()}
                    </Text>
                    <Text style={styles.searchResultSub} numberOfLines={1}>
                      {item.display_name}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>

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
  btnDisabled: { opacity: 0.4 },
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

  /* 검색 모달 */
  searchModal: {
    flex: 1,
    backgroundColor: '#fff',
  },
  searchModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  searchModalBack: {
    padding: 4,
  },
  searchModalInput: {
    flex: 1,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchModalBtn: {
    padding: 4,
  },
  searchEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  searchEmptyText: {
    fontSize: 15,
    color: '#bbb',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
    gap: 10,
  },
  searchResultMain: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  searchResultSub: {
    fontSize: 12,
    color: '#aaa',
  },

  /* 실시간 내비게이션 패널 */
  navPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
  },
  navPanelInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  navArrow: {
    fontSize: 32,
    width: 40,
    textAlign: 'center',
  },
  navTextBox: {
    flex: 1,
    gap: 2,
  },
  navInstruction: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  navDist: {
    fontSize: 13,
    color: '#aaa',
    fontWeight: '500',
  },
  navClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navReroute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  navRerouteText: {
    fontSize: 13,
    color: '#aaa',
  },

  /* 안내 시작/종료 버튼 */
  startNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#4285F4',
    marginBottom: 8,
  },
  startNavBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  stopNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e53935',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  stopNavBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e53935',
  },
});
