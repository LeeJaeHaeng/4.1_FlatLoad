import React, { createContext, useContext } from 'react';

// 데모 모드 — Firebase 인증 없이 고정 유저 반환
const DEMO_USER = {
  uid: 'demo-user-001',
  email: 'demo@flatroad.app',
  displayName: '데모 사용자',
  photoURL: null as string | null,
};

type DemoUser = typeof DEMO_USER;

interface AuthContextType {
  user: DemoUser;
  loading: false;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: DEMO_USER,
  loading: false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: DEMO_USER, loading: false, logout: async () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
