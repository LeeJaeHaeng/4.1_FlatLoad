import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: 정식 버전에서는 Firebase Google 로그인으로 교체 예정
// import * as Google from 'expo-auth-session/providers/google';
// import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';

export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  registerUser: (nickname: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  registerUser: async () => {},
  logout: async () => {},
});

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const KEY_USER_ID = '@flatroad/user_id';
const KEY_DISPLAY_NAME = '@flatroad/display_name';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const uid = await AsyncStorage.getItem(KEY_USER_ID);
      const displayName = await AsyncStorage.getItem(KEY_DISPLAY_NAME);
      if (uid && displayName) {
        setUser({ uid, displayName, email: '', photoURL: null });
      }
      setLoading(false);
    })();
  }, []);

  const registerUser = async (nickname: string) => {
    const uid = generateUUID();
    await AsyncStorage.setItem(KEY_USER_ID, uid);
    await AsyncStorage.setItem(KEY_DISPLAY_NAME, nickname);
    setUser({ uid, displayName: nickname, email: '', photoURL: null });
  };

  const logout = async () => {
    await AsyncStorage.removeItem(KEY_USER_ID);
    await AsyncStorage.removeItem(KEY_DISPLAY_NAME);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, registerUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
