import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, inMemoryPersistence } from 'firebase/auth';

// ─────────────────────────────────────────────────────────────────
//  Firebase 프로젝트 설정값
// ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyCNqDX-giNWELOqculIRuF-c4igfFD52cs',
  authDomain:        'map2026-233a5.firebaseapp.com',
  projectId:         'map2026-233a5',
  storageBucket:     'map2026-233a5.firebasestorage.app',
  messagingSenderId: '101038938383',
  appId:             '1:101038938383:android:85a90de6b0293e5028067a',
};
// ─────────────────────────────────────────────────────────────────

let app = getApps()[0];

if (!app) {
  app = initializeApp(firebaseConfig);
}

// inMemoryPersistence: react-native 환경에서 안전하게 동작
// metro.config.js 의 react-native 조건으로 RN 빌드가 사용되어 무한로딩 없음
// (앱 종료 후 재실행 시 재로그인 필요)
export const auth = getApps().length === 1
  ? initializeAuth(app, { persistence: inMemoryPersistence })
  : getAuth(app);

export default app;
