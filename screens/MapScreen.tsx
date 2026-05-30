import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ActivityIndicator,
  Modal, Image, Alert, ScrollView, TextInput, FlatList, Keyboard, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Gyroscope, Accelerometer, Magnetometer } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAllObstaclesWithBase64, ObstacleRecord } from '../utils/database';
import {
  apiGetObstacles,
  apiVoteObstacle,
  apiGetUserVote,
  apiGetAvoidLocations,
  apiGetRouteFacilities,
  apiGetSlopeWarnings,
  DeleteNotification,
  RouteFacilityType,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;
const OBSTACLE_CACHE_KEY = '@flatroad/cache/obstacles';
const OBSTACLE_REFRESH_INTERVAL_MS = 60_000;

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
const formatDuration = (seconds: number) => {
  const totalMinutes = Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
  if (hours > 0) return `${hours}시간`;
  return `${minutes}분`;
};
const formatEta = (secondsFromNow: number) => {
  const date = new Date(Date.now() + Math.max(0, secondsFromNow) * 1000);
  return date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
};

const KAKAO_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_KEY ?? '';
const KAKAO_JS_KEY = process.env.EXPO_PUBLIC_KAKAO_JS_KEY ?? '';

function speak(text: string) {
  Speech.stop();
  Speech.speak(text, { language: 'ko-KR', rate: 1.05, pitch: 1.0 });
}

type FilterCfg = {
  facilityType: RouteFacilityType;
  radiusM?: number;
  label: string;
};

interface SearchResultItem {
  display_name: string;
  address: string;
  lat: string;
  lon: string;
  distance?: number;
}

const FILTER_CFG: Record<string, FilterCfg> = {
  '경사로': {
    facilityType: 'ramp',
    label: '♿ 경사로',
  },
  '엘리베이터': {
    facilityType: 'elevator',
    label: '🛗 엘리베이터',
  },
  '장애인화장실': {
    facilityType: 'toilet',
    label: '🚻 장애인화장실',
  },
  '충전기': {
    facilityType: 'charger',
    radiusM: 5000,
    label: '🔌 충전기',
  },
};

const FACILITY_FILTERS = Object.keys(FILTER_CFG);

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[\s·ㆍ,./()\-]/g, '');
}

function scoreSearchResult(doc: any, query: string): number {
  const name = String(doc.place_name ?? '');
  const address = String(doc.road_address_name || doc.address_name || '');
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(name);
  const normalizedText = normalizeSearchText(`${name} ${address}`);
  const stationTerm = normalizeSearchText(query.replace(/\d+\s*번\s*출구/g, '').replace(/출구/g, '').trim());
  const exitNumber = query.match(/(\d+)\s*번\s*출구/)?.[1];
  const tokens = query.split(/\s+/).map(normalizeSearchText).filter(Boolean);
  const distance = Number(doc.distance);

  let score = 0;
  if (normalizedName === normalizedQuery) score += 1000;
  if (normalizedName.startsWith(normalizedQuery)) score += 800;
  if (normalizedName.includes(normalizedQuery)) score += 700;
  if (normalizedText.includes(normalizedQuery)) score += 500;

  for (const token of tokens) {
    if (normalizedName.includes(token)) score += 80;
    else if (normalizedText.includes(token)) score += 35;
  }

  if (stationTerm) {
    if (normalizedName.includes(stationTerm)) score += 450;
    else if (normalizedText.includes(stationTerm)) score += 220;
    else if (stationTerm.includes('역') && normalizedName.includes('역')) score -= 350;
  }

  if (exitNumber) {
    const normalizedExit = `${exitNumber}번출구`;
    if (normalizedName.includes(normalizedExit)) score += 180;
    else if (normalizedText.includes(normalizedExit)) score += 110;
  }

  if (Number.isFinite(distance)) {
    score -= Math.min(distance / 1000, 30);
  }

  return score;
}

function buildMapHTML(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script>
    function postToApp(payload) {
      var message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(message);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
      }
    }
    function reportMapError(message) {
      postToApp({ type: 'mapError', message: message });
    }
    window.onerror = function(message, source, lineno, colno, error) {
      reportMapError(error && error.message ? error.message : String(message || '지도 스크립트 오류'));
      return true;
    };
  </script>
  <script type="text/javascript" src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false" onerror="reportMapError('Kakao 지도 SDK를 불러오지 못했습니다.')"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #edf1f5; }
    #map {
      width: 100%;
      height: 100%;
      background: #edf1f5;
      transition: filter 220ms ease-out;
    }
    body.nav-mode #map {
      filter: saturate(1.08) contrast(1.05) brightness(0.92);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function() {
    if (!'${KAKAO_JS_KEY}') {
      reportMapError('EXPO_PUBLIC_KAKAO_JS_KEY가 비어 있습니다.');
      return;
    }
    if (!window.kakao || !window.kakao.maps) {
      reportMapError('Kakao 지도 SDK가 준비되지 않았습니다.');
      return;
    }
    kakao.maps.load(function() {
    try {
    var map = new kakao.maps.Map(document.getElementById('map'), {
      center: new kakao.maps.LatLng(${lat}, ${lng}),
      level: 3
    });

    var accuracyCircle = null;
    var currentHeading = 0;
    var hasHeading = false;
    var userOverlay = null;
    var obstacleOverlays = {};
    var obstacleData = {};
    var routePolyline = null;
    var destOverlay = null;
    var facilityOverlays = [];
    var maneuverOverlays = [];
    var navMode = false;
    var readySent = false;
    var readyTimer = setTimeout(function() {
      if (!readySent) reportMapError('지도 타일을 불러오지 못했습니다. 네트워크와 Kakao JavaScript 키 도메인 설정을 확인하세요.');
    }, 12000);

    function reportMapReady() {
      if (readySent) return;
      readySent = true;
      clearTimeout(readyTimer);
      postToApp({ type: 'mapReady' });
    }

    function buildLocationSVG(heading, showHeading) {
      var svg = '<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">';
      if (showHeading) {
        svg += '<g transform="rotate(' + heading + ', 40, 40)">'
          + '<path d="M40,40 L31,14 A 27 27 0 0 1 49,14 Z" fill="rgba(66,133,244,0.55)"/>'
          + '</g>';
      }
      svg += '<circle cx="40" cy="40" r="10" fill="white"/>';
      svg += '<circle cx="40" cy="40" r="7" fill="#4285F4"/>';
      svg += '</svg>';
      return svg;
    }

    userOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(${lat}, ${lng}),
      content: '<div style="width:80px;height:80px;">' + buildLocationSVG(0, false) + '</div>',
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 10
    });
    userOverlay.setMap(map);

    kakao.maps.event.addListener(map, 'zoom_changed', function() {
      if (navMode && userOverlay) {
        map.setCenter(userOverlay.getPosition());
      }
    });

    function updateLocation(lat, lng, accuracy) {
      var pos = new kakao.maps.LatLng(lat, lng);
      if (userOverlay) {
        userOverlay.setPosition(pos);
        userOverlay.setContent('<div style="width:80px;height:80px;">' + buildLocationSVG(currentHeading, hasHeading) + '</div>');
      }
      if (navMode) {
        map.setCenter(pos);
      }
      if (accuracyCircle) accuracyCircle.setMap(null);
      if (accuracy && accuracy < 500) {
        accuracyCircle = new kakao.maps.Circle({
          center: pos,
          radius: accuracy,
          strokeWeight: 1,
          strokeColor: '#4285F4',
          strokeOpacity: 0.5,
          fillColor: '#4285F4',
          fillOpacity: 0.08
        });
        accuracyCircle.setMap(map);
      }
    }

    function updateHeading(heading) {
      currentHeading = heading;
      hasHeading = true;
      if (navMode) {
        map.setCenter(userOverlay.getPosition());
      }
      if (userOverlay) {
        userOverlay.setContent('<div style="width:80px;height:80px;">' + buildLocationSVG(heading, true) + '</div>');
      }
    }

    function flyToLocation(lat, lng) {
      map.setCenter(new kakao.maps.LatLng(lat, lng));
    }

    function setNavigationMode(active) {
      navMode = !!active;
      document.body.classList.toggle('nav-mode', navMode);
      if (navMode) {
        map.setLevel(2);
        if (userOverlay) map.setCenter(userOverlay.getPosition());
      } else {
        map.setLevel(3);
      }
    }

    function onObstacleClick(id) {
      var d = obstacleData[id];
      if (!d) return;
      postToApp({
        type: 'obstacleClick',
        id: id,
        lat: d.lat,
        lng: d.lng,
        photoUri: d.photoUri,
        createdAt: d.createdAt
      });
    }

    function addObstacleMarker(id, lat, lng, photoUri, createdAt, count) {
      if (obstacleOverlays[id]) obstacleOverlays[id].setMap(null);
      obstacleData[id] = { lat: lat, lng: lng, photoUri: photoUri, createdAt: createdAt };
      var photoContent = photoUri
        ? '<img src="' + photoUri + '" style="width:100%;height:100%;object-fit:cover;"/>'
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;">⚠️</div>';
      var countBadge = (count > 1)
        ? '<div style="position:absolute;top:-4px;right:-2px;background:#e53935;color:white;border-radius:10px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2px solid white;padding:0 2px;">×' + count + '</div>'
        : '';
      var iconHtml = '<div style="position:relative;width:50px;height:60px;cursor:pointer;" onclick="onObstacleClick(' + id + ');">'
        + '<div style="position:absolute;top:0;left:3px;width:44px;height:44px;border-radius:50%;border:3px solid #FF5722;overflow:hidden;background:#eee;">'
        + photoContent
        + '</div>'
        + countBadge
        + '<div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:14px solid #FF5722;"></div>'
        + '</div>';
      var overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: iconHtml,
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: 5
      });
      overlay.setMap(map);
      obstacleOverlays[id] = overlay;
    }

    function clearObstacleMarkers() {
      Object.values(obstacleOverlays).forEach(function(o) { o.setMap(null); });
      obstacleOverlays = {};
      obstacleData = {};
    }

    function addFacilityMarker(lat, lng, type) {
      var cfg = { elevator:{e:'🛗',c:'#2196F3'}, ramp:{e:'♿',c:'#4CAF50'}, toilet:{e:'🚻',c:'#9C27B0'}, charger:{e:'🔌',c:'#00A693'}, slope:{e:'⚠️',c:'#FF5722'} }[type] || {e:'📍',c:'#607D8B'};
      var content = '<div style="width:34px;height:34px;border-radius:50%;background:'+cfg.c+';display:flex;align-items:center;justify-content:center;font-size:17px;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);">'+cfg.e+'</div>';
      var overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: content,
        xAnchor: 0.5,
        yAnchor: 0.5
      });
      overlay.setMap(map);
      facilityOverlays.push({ overlay: overlay, type: type });
    }

    function clearFacilityMarkers(type) {
      if (!type) {
        facilityOverlays.forEach(function(f) { f.overlay.setMap(null); });
        facilityOverlays = [];
      } else {
        facilityOverlays = facilityOverlays.filter(function(f) {
          if (f.type === type) { f.overlay.setMap(null); return false; }
          return true;
        });
      }
    }

    function addManeuverMarker(lat, lng, arrow, distStr) {
      var content = '<div style="background:#1a1a1a;color:white;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 5px rgba(0,0,0,0.4);">' + arrow + ' ' + distStr + '</div>';
      var overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: content
      });
      overlay.setMap(map);
      maneuverOverlays.push(overlay);
    }

    function clearManeuverMarkers() {
      maneuverOverlays.forEach(function(o) { o.setMap(null); });
      maneuverOverlays = [];
    }

    function drawRoute(coords, color) {
      if (routePolyline) routePolyline.setMap(null);
      var path = coords.map(function(c) { return new kakao.maps.LatLng(c[1], c[0]); });
      if (path.length < 2) return;
      routePolyline = new kakao.maps.Polyline({
        path: path,
        strokeWeight: 5,
        strokeColor: color || '#4285F4',
        strokeOpacity: 0.85,
        strokeStyle: 'solid'
      });
      routePolyline.setMap(map);
      var bounds = new kakao.maps.LatLngBounds();
      path.forEach(function(point) { bounds.extend(point); });
      map.setBounds(bounds, 80, 80, 80, 80);
    }

    function clearRoute() {
      if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
      if (destOverlay) { destOverlay.setMap(null); destOverlay = null; }
    }

    function addDestMarker(lat, lng) {
      if (destOverlay) destOverlay.setMap(null);
      destOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: '<div style="width:18px;height:18px;border-radius:50%;background:#FF5722;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.4);"></div>',
        xAnchor: 0.5,
        yAnchor: 0.5
      });
      destOverlay.setMap(map);
    }

    document.addEventListener('message', function(e) { handleMessage(e.data); });
    window.addEventListener('message', function(e) { handleMessage(e.data); });

    function handleMessage(data) {
      try {
        if (typeof data !== 'string') data = JSON.stringify(data);
        var msg = JSON.parse(data);
        if (msg.type === 'updateLocation') {
          updateLocation(msg.lat, msg.lng, msg.accuracy);
        } else if (msg.type === 'updateHeading') {
          updateHeading(msg.heading);
        } else if (msg.type === 'flyTo') {
          flyToLocation(msg.lat, msg.lng);
        } else if (msg.type === 'setNavigationMode') {
          setNavigationMode(msg.active);
        } else if (msg.type === 'setObstacles') {
          clearObstacleMarkers();
          msg.obstacles.forEach(function(o) {
            addObstacleMarker(o.id, o.latitude, o.longitude, o.photoUri, o.createdAt, o.count || 1);
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

    window.handleMessage = handleMessage;
    window.updateLocation = updateLocation;
    window.updateHeading = updateHeading;
    window.flyToLocation = flyToLocation;
    window.setNavigationMode = setNavigationMode;
    window.onObstacleClick = onObstacleClick;
    window.addObstacleMarker = addObstacleMarker;
    window.clearObstacleMarkers = clearObstacleMarkers;
    window.addFacilityMarker = addFacilityMarker;
    window.clearFacilityMarkers = clearFacilityMarkers;
    window.addManeuverMarker = addManeuverMarker;
    window.clearManeuverMarkers = clearManeuverMarkers;
    window.drawRoute = drawRoute;
    window.clearRoute = clearRoute;
    window.addDestMarker = addDestMarker;
    kakao.maps.event.addListener(map, 'tilesloaded', reportMapReady);
    } catch (e) {
      reportMapError(e && e.message ? e.message : '지도 초기화에 실패했습니다.');
    }
    }); // kakao.maps.load
    })();
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
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [mapReloadKey, setMapReloadKey] = useState(0);
  const [obstacles, setObstacles] = useState<(ObstacleRecord & { photoBase64: string })[]>([]);
  const [selectedObstacle, setSelectedObstacle] = useState<ObstacleRecord | null>(null);
  const [groupObstacles, setGroupObstacles] = useState<ObstacleRecord[] | null>(null);
  const groupMapRef = useRef<Record<number, number[]>>({});
  const [voteState, setVoteState] = useState<{ likes: number; dislikes: number; userVote: 'like' | 'dislike' | null } | null>(null);
  const webViewRef = useRef<WebView>(null);
  const webFrameRef = useRef<any>(null);
  const mapHtmlRef = useRef('');
  const mapHtmlKeyRef = useRef(-1);

  const postMapMessage = useCallback((payload: Record<string, any>) => {
    const message = JSON.stringify(payload);
    if (Platform.OS === 'web') {
      webFrameRef.current?.contentWindow?.postMessage(message, '*');
      return;
    }
    webViewRef.current?.injectJavaScript(`handleMessage(${JSON.stringify(message)}); true;`);
  }, []);

  const showMapAlert = useCallback((title: string, message: string) => {
    if (Platform.OS === 'web') {
      const win = globalThis as any;
      if (typeof win.alert === 'function') {
        win.alert(`${title}\n\n${message}`);
        return;
      }
    }
    Alert.alert(title, message);
  }, []);

  const handleMapMessageData = useCallback((data: unknown) => {
    try {
      const msg = typeof data === 'string' ? JSON.parse(data) : data as any;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'mapReady') {
        setMapReady(true);
        setMapLoadError(null);
      } else if (msg.type === 'mapError') {
        setMapReady(false);
        setMapLoadError(msg.message || '지도 초기화에 실패했습니다.');
      } else if (msg.type === 'obstacleClick') {
        const groupIds = groupMapRef.current[msg.id] ?? [msg.id];
        if (groupIds.length > 1) {
          const members = groupIds
            .map(id => obstacles.find(o => o.id === id))
            .filter(Boolean) as ObstacleRecord[];
          setGroupObstacles(members);
        } else {
          const found = obstacles.find(o => o.id === msg.id);
          if (found) setSelectedObstacle(found);
        }
      }
    } catch {}
  }, [obstacles]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const win = globalThis as any;
    const listener = (event: any) => {
      const iframeWindow = webFrameRef.current?.contentWindow;
      if (iframeWindow && event.source && event.source !== iframeWindow) return;
      handleMapMessageData(event.data);
    };
    win.addEventListener?.('message', listener);
    return () => win.removeEventListener?.('message', listener);
  }, [handleMapMessageData]);

  // 상보 필터 상태 refs
  const cfHeadingRef    = useRef<number | null>(null);
  const lastGyroTimeRef = useRef<number>(0);
  const accDataRef      = useRef<{ x: number; y: number; z: number } | null>(null);
  const magDataRef      = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastSendTimeRef = useRef<number>(0);
  const sensorSubsRef   = useRef<{ acc: any; mag: any; gyro: any } | null>(null);

  // 길찾기 상태
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distance: string;
    duration: string;
    durationSeconds: number;
    mode: 'safe' | 'normal';
    obstacleCount: number;
  } | null>(null);
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
  const [obstacleFilter, setObstacleFilter] = useState<'all' | 'certified'>('all');
  const [showObstacleFilterModal, setShowObstacleFilterModal] = useState(false);
  const [avoidSlopes, setAvoidSlopes] = useState(false);

  // TTS: 내비게이션 시작/종료 (항상 한국어 레이블 사용)
  useEffect(() => {
    if (isNavigating && maneuvers.length > 0) {
      const first = maneuvers[0];
      const label = getManeuverLabel(first.type);
      const dist = first.length > 0 ? `${Math.round(first.length * 1000)}미터 후 ` : '';
      const prefix = routeInfo?.mode === 'safe'
        ? '장애물을 피하는 안전 보행 경로 안내를 시작합니다.'
        : '경로 안내를 시작합니다.';
      speak(`${prefix} ${dist}${label}`);
    } else if (!isNavigating) {
      Speech.stop();
    }
  }, [isNavigating]);

  // TTS: 단계 변경 시 다음 지시 안내 (항상 한국어 레이블 사용)
  const prevManeuverIdxRef = useRef(-1);
  useEffect(() => {
    if (!isNavigating || maneuvers.length === 0) return;
    if (currentManeuverIdx === prevManeuverIdxRef.current) return;
    prevManeuverIdxRef.current = currentManeuverIdx;
    const step = maneuvers[currentManeuverIdx];
    if (!step) return;
    const label = getManeuverLabel(step.type);
    const nextStep = maneuvers[currentManeuverIdx + 1];
    if (nextStep) {
      const nextDist = nextStep.length > 0 ? `${Math.round(nextStep.length * 1000)}미터 후 ` : '';
      const nextLabel = getManeuverLabel(nextStep.type);
      speak(`${label}. ${nextDist}${nextLabel}`);
    } else {
      speak(label);
    }
  }, [currentManeuverIdx, isNavigating]);

  // TTS: 경로 이탈 재탐색
  useEffect(() => {
    if (isRerouting) speak('경로를 이탈했습니다. 경로를 재탐색합니다.');
  }, [isRerouting]);

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

      // 목적지 도착 감지 (마지막 단계 + 10m 이내)
      const lastStep = maneuvers[maneuvers.length - 1];
      if (lastStep && haversine(userLat, userLng, lastStep.lat, lastStep.lng) < 10) {
        speak('목적지에 도착했습니다.');
        setIsNavigating(false);
        setManeuvers([]);
        setRoutePoints([]);
        return;
      }

      setCurrentManeuverIdx(mIdx);

      // 다음 회전까지 거리
      if (mIdx + 1 < maneuvers.length) {
        setDistToNextTurn(haversine(userLat, userLng, maneuvers[mIdx + 1].lat, maneuvers[mIdx + 1].lng));
      }

      // 내비 중 지도 사용자 중심 유지
      postMapMessage({ type: 'flyTo', lat: userLat, lng: userLng });
    };
  }, [isNavigating, routePoints, maneuvers, isRerouting, destCoords, postMapMessage]);

  const searchDestination = async () => {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const locParam = location ? `&x=${location.lng}&y=${location.lat}` : '';
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(searchQuery)}&size=15&sort=accuracy${locParam}`,
        { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
      );
      const data = await res.json();
      const ranked = [...(data.documents ?? [])]
        .sort((a: any, b: any) => scoreSearchResult(b, searchQuery) - scoreSearchResult(a, searchQuery))
        .map((doc: any) => ({
          display_name: doc.place_name,
          address: doc.road_address_name || doc.address_name || '',
          lat: doc.y,
          lon: doc.x,
          distance: Number(doc.distance),
        }));
      setSearchResults(ranked);
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
        // ── 안전 보행 경로: 백엔드에서 신뢰도 기반 장애물 필터링 → Valhalla 호출 ─────
        const avoidLocs = await apiGetAvoidLocations(fromLat, fromLng, toLat, toLng);

        const body: Record<string, any> = {
          locations: [
            { lon: fromLng, lat: fromLat },
            { lon: toLng, lat: toLat },
          ],
          costing: 'pedestrian',
          costing_options: {
            pedestrian: {
              walking_speed: 4.5,
              step_penalty: avoidSlopes ? 60 : 30,
              alley_factor: 2.0,
              use_roads: 0.5,
              use_hills: avoidSlopes ? 0.05 : 0.5,
              max_hiking_difficulty: 1,
            },
          },
          units: 'km',
          language: 'ko',
        };
        if (avoidLocs.length > 0) body.avoid_locations = avoidLocs;

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        let data: any;
        try {
          const res = await fetch('https://valhalla1.openstreetmap.de/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          data = await res.json();
        } catch {
          // Valhalla 연결 실패 시 OSRM으로 폴백
          await fetchOsrmRoute(fromLat, fromLng, toLat, toLng, 'foot', '#4285F4', 'safe');
          return;
        } finally {
          clearTimeout(timer);
        }

        if (data.error || !data.trip?.legs?.length) {
          await fetchOsrmRoute(fromLat, fromLng, toLat, toLng, 'foot', '#4285F4', 'safe');
          return;
        }
        const leg = data.trip.legs[0];
        const latlngs = decodePolyline(leg.shape);
        const geoCoords = latlngs.map(([la, lo]) => [lo, la]);
        const distKm = data.trip.summary.length as number;
        const durSec = data.trip.summary.time as number;
        const distStr = distKm >= 1 ? `${distKm.toFixed(1)}km` : `${Math.round(distKm * 1000)}m`;
        const durStr = formatDuration(durSec);
        const nearObstacles = countObstaclesNearRoute(latlngs);
        setRouteInfo({ distance: distStr, duration: durStr, durationSeconds: durSec, mode, obstacleCount: nearObstacles });
        postMapMessage({ type: 'drawRoute', coords: geoCoords, color: '#4285F4' });

        let parsedManeuvers: ManeuverStep[] = (leg.maneuvers ?? []).map((m: any) => ({
          type: m.type,
          instruction: getManeuverLabel(m.type),
          length: m.length ?? 0,
          beginShapeIndex: m.begin_shape_index ?? 0,
          lat: latlngs[m.begin_shape_index]?.[0] ?? fromLat,
          lng: latlngs[m.begin_shape_index]?.[1] ?? fromLng,
        }));
        if (parsedManeuvers.length === 0) {
          parsedManeuvers = [
            {
              type: 1,
              instruction: '경로를 따라 이동',
              length: distKm,
              beginShapeIndex: 0,
              lat: fromLat,
              lng: fromLng,
            },
            {
              type: 4,
              instruction: '목적지 도착',
              length: 0,
              beginShapeIndex: Math.max(0, latlngs.length - 1),
              lat: toLat,
              lng: toLng,
            },
          ];
        }
        setRoutePoints(latlngs);
        setManeuvers(parsedManeuvers);
        setCurrentManeuverIdx(0);
        setDistToNextTurn(parsedManeuvers[1] ? Math.round(parsedManeuvers[0].length * 1000) : 0);

        postMapMessage({ type: 'clearManeuverMarkers' });
        parsedManeuvers.slice(0, -1).forEach((step, i) => {
          if (i >= 8) return;
          const arrow = getManeuverIcon(step.type);
          const label = getManeuverLabel(step.type);
          postMapMessage({
            type: 'addManeuverMarker',
            lat: step.lat,
            lng: step.lng,
            arrow,
            distStr: label,
          });
        });

        fetchSlopeWarnings(latlngs);
      } else {
        // ── 일반 경로: OSRM driving (자동차) ────────────────────
        await fetchOsrmRoute(fromLat, fromLng, toLat, toLng, 'driving', '#888888', 'normal');
      }
    } catch (e: any) {
      Alert.alert('경로 오류', String(e?.message ?? e));
    } finally {
      setRouteLoading(false);
    }
  };

  const fetchOsrmRoute = async (
    fromLat: number, fromLng: number,
    toLat: number, toLng: number,
    profile: string, color: string, mode: 'safe' | 'normal'
  ) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let data: any;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/${profile}/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&overview=full`,
        { signal: ctrl.signal }
      );
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (data.code !== 'Ok' || !data.routes?.length) {
      Alert.alert('오류', '경로를 찾을 수 없습니다.');
      return;
    }
    const route = data.routes[0];
    const dist = route.distance as number;
    const dur = route.duration as number;
    const distStr = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`;
    const durStr = formatDuration(dur);
    const latlngs: [number, number][] = route.geometry.coordinates.map(([lo, la]: number[]) => [la, lo]);
    const nearObstacles = countObstaclesNearRoute(latlngs);
    setRouteInfo({ distance: distStr, duration: durStr, durationSeconds: dur, mode, obstacleCount: nearObstacles });
    postMapMessage({ type: 'drawRoute', coords: route.geometry.coordinates, color });
    if (mode === 'safe') {
      const fallbackManeuvers: ManeuverStep[] = [
        {
          type: 1,
          instruction: '경로를 따라 이동',
          length: dist / 1000,
          beginShapeIndex: 0,
          lat: fromLat,
          lng: fromLng,
        },
        {
          type: 4,
          instruction: '목적지 도착',
          length: 0,
          beginShapeIndex: Math.max(0, latlngs.length - 1),
          lat: toLat,
          lng: toLng,
        },
      ];
      setRoutePoints(latlngs);
      setManeuvers(fallbackManeuvers);
      setCurrentManeuverIdx(0);
      setDistToNextTurn(dist);
    } else {
      setRoutePoints([]);
      setManeuvers([]);
      setCurrentManeuverIdx(0);
      setDistToNextTurn(0);
    }
  };

  const fetchSlopeWarnings = async (routePts: [number, number][]) => {
    if (!routePts.length) return;
    const warnings = await apiGetSlopeWarnings(routePts);
    warnings.forEach(({ lat, lng }) => {
      if (routePts.some(([rlat, rlng]) => haversine(lat, lng, rlat, rlng) < 80)) {
        postMapMessage({ type: 'addFacilityMarker', lat, lng, facilityType: 'slope' });
      }
    });
  };

  const toggleFilter = async (filterName: string) => {
    const cfg = FILTER_CFG[filterName];
    if (!cfg) return;

    // 이미 활성 → 마커 제거 후 비활성화
    if (activeFilters.has(filterName)) {
      setActiveFilters(prev => { const n = new Set(prev); n.delete(filterName); return n; });
      postMapMessage({ type: 'clearFacilityMarkers', facilityType: cfg.facilityType });
      return;
    }

    if (!location) {
      showMapAlert('알림', '위치 정보를 가져오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setFilterLoading(filterName);
    try {
      const facilities = await apiGetRouteFacilities(
        location.lat,
        location.lng,
        [cfg.facilityType],
        cfg.radiusM ?? 3000,
      );
      facilities.forEach(({ lat, lng, type }) => {
        postMapMessage({ type: 'addFacilityMarker', lat, lng, facilityType: type });
      });
      const count = facilities.length;

      setActiveFilters(prev => new Set([...prev, filterName]));
      if (count === 0) {
        showMapAlert('검색 결과', `주변 ${filterName} 정보가 없습니다.`);
      } else {
        showMapAlert('검색 완료', `주변 ${filterName} ${count}개를 찾았습니다.`);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        showMapAlert('시간 초과', '서버 응답이 너무 늦습니다. 다시 시도해주세요.');
      } else {
        showMapAlert('오류', `${filterName} 정보를 불러오지 못했습니다: ${e?.message ?? ''}`);
      }
    } finally {
      setFilterLoading(null);
    }
  };

  const selectDestination = async (item: SearchResultItem) => {
    setShowSearch(false);
    setSearchResults([]);
    const shortName = item.display_name;
    setDestination(shortName);
    const toLat = parseFloat(item.lat);
    const toLng = parseFloat(item.lon);
    setDestCoords({ lat: toLat, lng: toLng });
    setRouteInfo(null);
    postMapMessage({ type: 'addDestMarker', lat: toLat, lng: toLng });
    if (location) {
      await fetchRoute(location.lat, location.lng, toLat, toLng, 'safe');
    }
  };

  const clearDestination = () => {
    setDestination('');
    setDestCoords(null);
    setRouteInfo(null);
    setSearchQuery('');
    postMapMessage({ type: 'clearRoute' });
  };

  const showWip = () => Alert.alert('알림', '아직 개발중입니다.');

  useEffect(() => {
    let posSubscription: Location.LocationSubscription | null = null;

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

      if (Platform.OS !== 'web') {
        try {
          Accelerometer.setUpdateInterval(20);
          Magnetometer.setUpdateInterval(20);
          Gyroscope.setUpdateInterval(16);

          const accSub = Accelerometer.addListener(data => { accDataRef.current = data; });
          const magSub = Magnetometer.addListener(data => { magDataRef.current = data; });
          const gyroSub = Gyroscope.addListener(({ x: gx, y: gy, z: gz }) => {
            const now = Date.now();
            const acc = accDataRef.current;
            const mag = magDataRef.current;
            if (!acc || !mag) { lastGyroTimeRef.current = now; return; }

            const dt = lastGyroTimeRef.current > 0
              ? (now - lastGyroTimeRef.current) / 1000
              : 0.016;
            lastGyroTimeRef.current = now;

            // 가속도계 정규화 (중력 방향 단위벡터)
            const { x: ax, y: ay, z: az } = acc;
            const { x: mx, y: my, z: mz } = mag;
            const accNorm = Math.sqrt(ax * ax + ay * ay + az * az);
            if (accNorm < 0.1) return;
            const axn = ax / accNorm, ayn = ay / accNorm, azn = az / accNorm;

            // 자이로 벡터를 중력 방향에 투영해 yaw 성분만 추출 (기기 기울기 무관)
            const yawRate = -(gx * axn + gy * ayn + gz * azn);
            const gyroDeg = yawRate * dt * (180 / Math.PI);

            // 틸트 보정 지자기 절대 방위
            const pitch = Math.atan2(-axn, Math.sqrt(ayn * ayn + azn * azn));
            const roll  = Math.atan2(ayn, azn);
            const Xh = mx * Math.cos(pitch) + mz * Math.sin(pitch);
            const Yh = mx * Math.sin(roll) * Math.sin(pitch)
                     + my * Math.cos(roll)
                     - mz * Math.sin(roll) * Math.cos(pitch);
            let magDeg = Math.atan2(-Yh, Xh) * (180 / Math.PI);
            magDeg = ((magDeg % 360) + 360) % 360;

            // 상보 필터: α=0.97 (자이로 단기 정확도 + 자기계 장기 보정)
            const ALPHA = 0.97;
            if (cfHeadingRef.current === null) {
              cfHeadingRef.current = magDeg;
            } else {
              let gh = (cfHeadingRef.current + gyroDeg + 360) % 360;
              let diff = magDeg - gh;
              if (diff > 180) diff -= 360;
              if (diff < -180) diff += 360;
              cfHeadingRef.current = (gh + (1 - ALPHA) * diff + 360) % 360;
            }

            // 15Hz(67ms)로 throttle해서 상태 업데이트
            if (now - lastSendTimeRef.current >= 67) {
              setHeading(Math.round(cfHeadingRef.current!));
              lastSendTimeRef.current = now;
            }
          });

          sensorSubsRef.current = { acc: accSub, mag: magSub, gyro: gyroSub };
        } catch {
          // 센서 미지원 기기에서는 방향 표시 없이 동작
        }
      }
    })();

    return () => {
      posSubscription?.remove();
      const s = sensorSubsRef.current;
      if (s) { s.acc.remove(); s.mag.remove(); s.gyro.remove(); }
    };
  }, []);

  const lastObstacleFetchRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const applyObstacles = (list: any[]) => {
        if (cancelled) return;
        setObstacles(list.map(o => ({ ...o, photoBase64: o.photoBase64 ?? o.photoUri })) as any);
      };

      (async () => {
        const now = Date.now();
        if (now - lastObstacleFetchRef.current < OBSTACLE_REFRESH_INTERVAL_MS && obstacles.length > 0) {
          return;
        }
        lastObstacleFetchRef.current = now;

        let hasWarmData = obstacles.length > 0;
        try {
          const cached = await AsyncStorage.getItem(OBSTACLE_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              hasWarmData = true;
              applyObstacles(parsed);
            }
          }
        } catch {}

        try {
          const list = await apiGetObstacles();
          const normalized = list.map(o => ({ ...o, photoBase64: o.photoUri }));
          applyObstacles(normalized);
          AsyncStorage.setItem(OBSTACLE_CACHE_KEY, JSON.stringify(normalized)).catch(() => {});
        } catch {
          if (!hasWarmData) {
            getAllObstaclesWithBase64().then(applyObstacles).catch(console.error);
          }
        }
      })();

      return () => { cancelled = true; };
    }, [obstacles.length])
  );

  useEffect(() => {
    if (!selectedObstacle) { setVoteState(null); return; }
    const userId = user?.uid ?? '';
    apiGetUserVote(selectedObstacle.id, userId).then(userVote => {
      setVoteState({
        likes: selectedObstacle.likes,
        dislikes: selectedObstacle.dislikes,
        userVote,
      });
    });
  }, [selectedObstacle, user]);

  const handleVote = async (voteType: 'like' | 'dislike') => {
    if (!selectedObstacle || !user) return;
    try {
      const result = await apiVoteObstacle(selectedObstacle.id, user.uid, voteType);
      setVoteState(result);
      setObstacles(prev =>
        prev.map(o => o.id === selectedObstacle.id
          ? { ...o, likes: result.likes, dislikes: result.dislikes }
          : o
        )
      );
    } catch {
      Alert.alert('오류', '투표에 실패했습니다. 다시 시도해주세요.');
    }
  };

  useEffect(() => {
    if (!mapReady || !location) return;
    postMapMessage({
      type: 'updateLocation',
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy ?? 0,
    });
    navUpdateRef.current(location.lat, location.lng);
  }, [location, mapReady, postMapMessage]);

  useEffect(() => {
    if (!mapReady || heading === null) return;
    postMapMessage({ type: 'updateHeading', heading });
  }, [heading, mapReady, postMapMessage]);

  useEffect(() => {
    if (!mapReady) return;
    postMapMessage({ type: 'setNavigationMode', active: isNavigating });
    if (isNavigating && location) {
      postMapMessage({ type: 'flyTo', lat: location.lat, lng: location.lng });
    }
  }, [isNavigating, mapReady, location, postMapMessage]);

  useEffect(() => {
    if (!mapReady) return;
    const filtered = obstacleFilter === 'certified'
      ? obstacles.filter(o => (o as any).isCertified)
      : obstacles;

    // 10m 이내 장애물 그룹화 — 대표 핀 하나에 ×N 배지 표시
    const grouped: { repId: number; obs: typeof filtered[0]; count: number }[] = [];
    const newGroupMap: Record<number, number[]> = {};
    for (const obs of filtered) {
      let added = false;
      for (const g of grouped) {
        if (haversine(obs.latitude, obs.longitude, g.obs.latitude, g.obs.longitude) < 10) {
          newGroupMap[g.repId].push(obs.id);
          g.count++;
          added = true;
          break;
        }
      }
      if (!added) {
        newGroupMap[obs.id] = [obs.id];
        grouped.push({ repId: obs.id, obs, count: 1 });
      }
    }
    groupMapRef.current = newGroupMap;

    postMapMessage({
      type: 'setObstacles',
      obstacles: grouped.map(g => ({
        id: g.repId,
        latitude: g.obs.latitude,
        longitude: g.obs.longitude,
        photoUri: (g.obs as any).photoBase64 || g.obs.photoUri,
        createdAt: g.obs.createdAt,
        isCertified: (g.obs as any).isCertified ?? false,
        count: g.count,
      })),
    });
  }, [obstacles, mapReady, obstacleFilter, postMapMessage]);

  const startNavigation = () => {
    if (!routeInfo || routeInfo.mode !== 'safe' || maneuvers.length === 0) {
      if (location && destCoords) {
        fetchRoute(location.lat, location.lng, destCoords.lat, destCoords.lng, 'safe');
      }
      return;
    }
    prevManeuverIdxRef.current = -1;
    setCurrentManeuverIdx(0);
    setDistToNextTurn(Math.round((maneuvers[0]?.length ?? 0) * 1000));
    setIsNavigating(true);
  };

  const stopNavigation = () => {
    setIsNavigating(false);
    setManeuvers([]);
    setRoutePoints([]);
    setCurrentManeuverIdx(0);
    setDistToNextTurn(0);
    Speech.stop();
    postMapMessage({ type: 'setNavigationMode', active: false });
  };

  const flyToCurrentLocation = () => {
    if (!location) return;
    postMapMessage({ type: 'flyTo', lat: location.lat, lng: location.lng });
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
  if (mapHtmlKeyRef.current !== mapReloadKey) {
    mapHtmlRef.current = buildMapHTML(initLat, initLng);
    mapHtmlKeyRef.current = mapReloadKey;
  }
  const mapHtml = mapHtmlRef.current;
  const mapUrl = `/kakao-map.html?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&lat=${encodeURIComponent(String(initLat))}&lng=${encodeURIComponent(String(initLng))}&v=${mapReloadKey}`;
  const currentStep = maneuvers[currentManeuverIdx];
  const nextStep = maneuvers[currentManeuverIdx + 1];
  const currentInstruction = currentStep?.instruction || getManeuverLabel(currentStep?.type ?? 1);
  const currentIcon = getManeuverIcon(currentStep?.type ?? 1);
  const nextInstruction = nextStep
    ? `${fmtDist(Math.round((nextStep.length ?? 0) * 1000))} 후 ${getManeuverLabel(nextStep.type)}`
    : '목적지까지 계속 이동';
  const remainingDistance = (() => {
    if (!location || routePoints.length < 2) return routeInfo?.distance ?? '';
    let nearestIdx = 0;
    let nearestDistance = Infinity;
    routePoints.forEach(([lat, lng], idx) => {
      const distance = haversine(location.lat, location.lng, lat, lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIdx = idx;
      }
    });
    let total = nearestDistance;
    for (let i = nearestIdx; i < routePoints.length - 1; i++) {
      total += haversine(routePoints[i][0], routePoints[i][1], routePoints[i + 1][0], routePoints[i + 1][1]);
    }
    return fmtDist(total);
  })();
  const etaText = routeInfo ? formatEta(routeInfo.durationSeconds) : '';

  return (
    <View style={styles.container}>
      {/* 지도 (전체 화면) */}
      {Platform.OS === 'web' ? (
        React.createElement('iframe' as any, {
          key: mapReloadKey,
          ref: webFrameRef,
          src: mapUrl,
          title: 'Kakao map',
          style: {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 0,
          },
          onLoad: () => setMapLoadError(null),
        })
      ) : (
        <WebView
          key={mapReloadKey}
          ref={webViewRef}
          style={StyleSheet.absoluteFill}
          source={{ html: mapHtml, baseUrl: 'http://localhost' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          onLoadStart={() => {
            setMapReady(false);
            setMapLoadError(null);
          }}
          onError={() => setMapLoadError('지도를 불러오는 데 실패했습니다.')}
          onMessage={(e) => handleMapMessageData(e.nativeEvent.data)}
        />
      )}

      {!mapReady || mapLoadError ? (
        <View pointerEvents={mapLoadError ? 'auto' : 'none'} style={styles.mapStatusOverlay}>
          <View style={styles.mapStatusCard}>
            {mapLoadError ? (
              <>
                <MaterialIcons name="map" size={28} color="#F5A623" />
                <Text style={styles.mapStatusTitle}>지도를 표시할 수 없습니다</Text>
                <Text style={styles.mapStatusText}>{mapLoadError}</Text>
                <TouchableOpacity
                  style={styles.mapRetryButton}
                  onPress={() => {
                    setMapLoadError(null);
                    setMapReady(false);
                    setMapReloadKey(key => key + 1);
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="refresh" size={18} color="#fff" />
                  <Text style={styles.mapRetryText}>다시 불러오기</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ActivityIndicator size="small" color="#F5A623" />
                <Text style={styles.mapStatusText}>지도 불러오는 중...</Text>
              </>
            )}
          </View>
        </View>
      ) : null}

      {/* 상단 오버레이: 검색창 + 필터 */}
      {!isNavigating && (
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
            {destination ? (
              <TouchableOpacity onPress={clearDestination} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={18} color="#aaa" />
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.editButton} onPress={showWip} activeOpacity={0.8}>
            <MaterialIcons name="edit-note" size={26} color="#333" />
          </TouchableOpacity>
        </View>

        <View style={styles.filterWrap}>
          <TouchableOpacity
            style={[styles.filterChip, obstacleFilter === 'certified' && styles.filterChipActive]}
            onPress={() => setShowObstacleFilterModal(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="tune" size={14} color={obstacleFilter === 'certified' ? '#fff' : '#555'} />
            <Text style={obstacleFilter === 'certified' ? styles.filterChipActiveText : styles.filterChipText}>
              {obstacleFilter === 'certified' ? ' ⭐ 인증 장애물' : ' 필터'}
            </Text>
          </TouchableOpacity>
          {FACILITY_FILTERS.map((name) => {
            const cfg = FILTER_CFG[name];
            const active = activeFilters.has(name);
            const loading = filterLoading === name;
            return (
              <React.Fragment key={name}>
                <TouchableOpacity
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => toggleFilter(name)}
                  activeOpacity={0.8}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator size={12} color={active ? '#fff' : '#555'} />
                    : <Text style={active ? styles.filterChipActiveText : styles.filterChipText}>
                        {cfg.label}
                      </Text>
                  }
                </TouchableOpacity>
                {name === '경사로' && (
                  <TouchableOpacity
                    style={[styles.filterChip, avoidSlopes && styles.slopeToggleActive]}
                    onPress={() => setAvoidSlopes(v => !v)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="trending-flat" size={14} color={avoidSlopes ? '#fff' : '#555'} />
                    <Text style={avoidSlopes ? styles.filterChipActiveText : styles.filterChipText}>
                      {' '}경사 회피
                    </Text>
                  </TouchableOpacity>
                )}
              </React.Fragment>
            );
          })}
        </View>
      </View>
      )}

      {/* 전용 내비게이션 화면 */}
      {isNavigating && maneuvers.length > 0 && (
        <>
          <View pointerEvents="none" style={styles.navigationDim} />
          <View style={[styles.navTurnCard, { top: insets.top + 10 }]}>
            <View style={styles.navTurnMain}>
              <Text style={styles.navTurnArrow}>{currentIcon}</Text>
              <View style={styles.navTurnTextBox}>
                <Text style={styles.navTurnDistance}>{fmtDist(distToNextTurn)}</Text>
                <Text style={styles.navTurnInstruction} numberOfLines={1}>
                  {currentInstruction}
                </Text>
              </View>
            </View>
            <View style={styles.navNextRow}>
              <Text style={styles.navNextArrow}>{nextStep ? getManeuverIcon(nextStep.type) : '🏁'}</Text>
              <Text style={styles.navNextText} numberOfLines={1}>
                {nextInstruction}
              </Text>
            </View>
          </View>

          <View style={[styles.navStatusStack, { top: insets.top + 148 }]}>
            <View style={styles.navSpeedBadge}>
              <Text style={styles.navSpeedValue}>0</Text>
              <Text style={styles.navSpeedUnit}>km/h</Text>
            </View>
            {routeInfo?.obstacleCount ? (
              <View style={styles.navObstacleBadge}>
                <MaterialIcons name="warning" size={18} color="#FF5722" />
                <Text style={styles.navObstacleText}>{routeInfo.obstacleCount}개</Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.navRightStack, { top: insets.top + 84 }]}>
            <TouchableOpacity style={styles.navRoundBtn} activeOpacity={0.8}>
              <MaterialIcons name="mic" size={23} color="#26D367" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navRoundBtn} onPress={flyToCurrentLocation} activeOpacity={0.8}>
              <MaterialIcons name="my-location" size={23} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navRoundBtn} activeOpacity={0.8}>
              <MaterialIcons name="layers" size={23} color="#fff" />
            </TouchableOpacity>
          </View>

          {isRerouting && (
            <View style={styles.navToast}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.navToastText}>경로 재탐색 중...</Text>
            </View>
          )}

          <View style={[styles.navBottomBar, { paddingBottom: insets.bottom + 10 }]}>
            <View style={styles.navBottomMeta}>
              <Text style={styles.navBottomLabel}>안전 보행 안내</Text>
              <Text style={styles.navBottomTitle} numberOfLines={1}>
                {destination || '목적지'}
              </Text>
              <Text style={styles.navBottomSub}>
                {etaText} 도착 · {remainingDistance || routeInfo?.distance || '-'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.navMenuBtn}
              onPress={stopNavigation}
              activeOpacity={0.8}
            >
              <MaterialIcons name="stop" size={22} color="#fff" />
              <Text style={styles.navMenuText}>종료</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 우측 플로팅 버튼들 */}
      {!isNavigating && (
      <View style={styles.rightButtons}>
        <TouchableOpacity
          style={styles.mapIconBtn}
          onPress={flyToCurrentLocation}
          activeOpacity={0.8}
        >
          <MaterialIcons name="my-location" size={22} color={location ? '#333' : '#aaa'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mapIconBtn}
          onPress={() => {
            apiGetObstacles()
              .then(list => setObstacles(list.map(o => ({ ...o, photoBase64: o.photoUri })) as any))
              .catch(() => {});
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons name="refresh" size={22} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mapIconBtn}
          onPress={() => navigation.navigate('기여하기')}
          activeOpacity={0.8}
        >
          <MaterialIcons name="add" size={22} color="#333" />
        </TouchableOpacity>
      </View>
      )}


      {/* 하단 경로 시트 */}
      {!isNavigating && (
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
                {routeInfo.distance} · 약 {routeInfo.duration} · {etaText} 도착
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
            onPress={startNavigation}
            activeOpacity={0.8}
          >
            <MaterialIcons name="navigation" size={18} color="#fff" />
            <Text style={styles.startNavBtnText}>안전 안내 시작</Text>
          </TouchableOpacity>
        )}
        {isNavigating && (
          <TouchableOpacity
            style={styles.stopNavBtn}
            onPress={stopNavigation}
            activeOpacity={0.8}
          >
            <MaterialIcons name="stop" size={18} color="#e53935" />
            <Text style={styles.stopNavBtnText}>안내 종료</Text>
          </TouchableOpacity>
        )}
      </View>
      )}

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
                      {item.display_name}
                    </Text>
                    <Text style={styles.searchResultSub} numberOfLines={1}>
                      {item.address}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>

      {/* 장애물 필터 모달 */}
      <Modal
        transparent
        animationType="fade"
        visible={showObstacleFilterModal}
        onRequestClose={() => setShowObstacleFilterModal(false)}
      >
        <TouchableOpacity
          style={styles.filterModalOverlay}
          activeOpacity={1}
          onPress={() => setShowObstacleFilterModal(false)}
        >
          <View style={styles.filterModalCard}>
            <Text style={styles.filterModalTitle}>장애물 필터</Text>
            {([
              { key: 'all',       label: '전체 장애물',          desc: '모든 사용자가 올린 장애물 표시', icon: 'location-on' },
              { key: 'certified', label: '⭐ 인증 사용자 장애물', desc: '인증된 기관이 올린 장애물만 표시', icon: 'verified' },
            ] as const).map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.filterOption, obstacleFilter === opt.key && styles.filterOptionActive]}
                onPress={() => { setObstacleFilter(opt.key); setShowObstacleFilterModal(false); }}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={opt.icon as any}
                  size={20}
                  color={obstacleFilter === opt.key ? '#F5A623' : '#888'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.filterOptionLabel, obstacleFilter === opt.key && { color: '#F5A623' }]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.filterOptionDesc}>{opt.desc}</Text>
                </View>
                {obstacleFilter === opt.key && (
                  <MaterialIcons name="check" size={18} color="#F5A623" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 동일 위치 장애물 그룹 목록 모달 */}
      {groupObstacles && (
        <Modal
          transparent
          animationType="slide"
          visible={!!groupObstacles}
          onRequestClose={() => setGroupObstacles(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>이 위치의 장애물 {groupObstacles.length}개</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {groupObstacles.map((obs, i) => (
                  <TouchableOpacity
                    key={obs.id}
                    style={styles.groupItem}
                    activeOpacity={0.75}
                    onPress={() => {
                      setGroupObstacles(null);
                      setSelectedObstacle(obs);
                    }}
                  >
                    {obs.photoUri
                      ? <Image source={{ uri: obs.photoUri }} style={styles.groupThumb} />
                      : <View style={[styles.groupThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' }]}>
                          <Text style={{ fontSize: 22 }}>⚠️</Text>
                        </View>
                    }
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupItemDate}>
                        {new Date(obs.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                      </Text>
                      <Text style={styles.groupItemCoords}>
                        {obs.latitude.toFixed(5)}, {obs.longitude.toFixed(5)}
                      </Text>
                      <Text style={styles.groupItemUser}>
                        {(obs as any).isCertified ? '⭐ ' : ''}{obs.displayName || obs.userEmail || '익명'}
                      </Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color="#ccc" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setGroupObstacles(null)}>
                <Text style={styles.modalCloseText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

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
              {selectedObstacle.photoUri ? (
                <Image
                  source={{ uri: selectedObstacle.photoUri }}
                  style={styles.modalImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.modalImage, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' }]}>
                  <Text style={{ fontSize: 40 }}>⚠️</Text>
                  <Text style={{ color: '#888', fontSize: 12, marginTop: 4 }}>사진 없음</Text>
                </View>
              )}
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
                  {(selectedObstacle as any).isCertified ? '⭐ ' : ''}
                  {selectedObstacle.displayName
                    ? `${selectedObstacle.displayName} (${selectedObstacle.userEmail})`
                    : selectedObstacle.userEmail || '익명'}
                  {(selectedObstacle as any).isCertified ? ' · 인증된 기여자' : ''}
                </Text>
              </View>
              <View style={styles.voteRow}>
                <TouchableOpacity
                  style={[styles.voteButton, voteState?.userVote === 'like' && styles.voteButtonLiked]}
                  onPress={() => handleVote('like')}
                >
                  <MaterialIcons name="thumb-up" size={20} color={voteState?.userVote === 'like' ? '#fff' : '#4285F4'} />
                  <Text style={[styles.voteCount, voteState?.userVote === 'like' && styles.voteCountActive]}>
                    {voteState?.likes ?? selectedObstacle.likes}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.voteButton, voteState?.userVote === 'dislike' && styles.voteButtonDisliked]}
                  onPress={() => handleVote('dislike')}
                >
                  <MaterialIcons name="thumb-down" size={20} color={voteState?.userVote === 'dislike' ? '#fff' : '#e53935'} />
                  <Text style={[styles.voteCount, voteState?.userVote === 'dislike' && styles.voteCountActive]}>
                    {voteState?.dislikes ?? selectedObstacle.dislikes}
                  </Text>
                </TouchableOpacity>
              </View>
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
  mapStatusOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  mapStatusCard: {
    minWidth: 220,
    maxWidth: 320,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  },
  mapStatusTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#222',
    textAlign: 'center',
  },
  mapStatusText: {
    fontSize: 12,
    color: '#777',
    textAlign: 'center',
    lineHeight: 18,
  },
  mapRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#F5A623',
  },
  mapRetryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
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
  filterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingRight: 4,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  filterModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 8,
  },
  filterModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#f8f8f8',
  },
  filterOptionActive: {
    backgroundColor: '#fff8ee',
    borderWidth: 1.5,
    borderColor: '#F5A623',
  },
  filterOptionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  filterOptionDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
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

  /* 전용 내비게이션 화면 */
  navigationDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  navTurnCard: {
    position: 'absolute',
    left: 12,
    width: 222,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0B5FC7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 12,
  },
  navTurnMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  navTurnArrow: {
    width: 54,
    textAlign: 'center',
    color: '#fff',
    fontSize: 44,
    fontWeight: '900',
  },
  navTurnTextBox: {
    flex: 1,
  },
  navTurnDistance: {
    color: '#fff',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  navTurnInstruction: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  navNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#09479A',
  },
  navNextArrow: {
    width: 28,
    color: '#fff',
    fontSize: 20,
    textAlign: 'center',
  },
  navNextText: {
    flex: 1,
    color: '#DCEBFF',
    fontSize: 13,
    fontWeight: '700',
  },
  navStatusStack: {
    position: 'absolute',
    left: 16,
    gap: 10,
  },
  navSpeedBadge: {
    width: 66,
    height: 66,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,10,0.78)',
  },
  navSpeedValue: {
    color: '#fff',
    fontSize: 31,
    lineHeight: 34,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  navSpeedUnit: {
    color: '#D6D6D6',
    fontSize: 10,
    fontWeight: '700',
  },
  navObstacleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 66,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  navObstacleText: {
    color: '#FF5722',
    fontSize: 13,
    fontWeight: '900',
  },
  navRightStack: {
    position: 'absolute',
    right: 14,
    gap: 10,
  },
  navRoundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,18,18,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  navToast: {
    position: 'absolute',
    left: 28,
    right: 28,
    bottom: 108,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  navToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  navBottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: 'rgba(15,15,18,0.94)',
  },
  navBottomMeta: {
    flex: 1,
  },
  navBottomLabel: {
    color: '#7DB5FF',
    fontSize: 12,
    fontWeight: '800',
  },
  navBottomTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  navBottomSub: {
    color: '#D8D8D8',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  navMenuBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2E',
  },
  navMenuText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
  },

  slopeToggleActive: {
    backgroundColor: '#4CAF50',
  },

  /* 그룹 목록 모달 */
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  groupThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#eee',
  },
  groupItemDate: { fontSize: 13, fontWeight: '600', color: '#333' },
  groupItemCoords: { fontSize: 11, color: '#999', marginTop: 1 },
  groupItemUser: { fontSize: 11, color: '#aaa', marginTop: 1 },

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
