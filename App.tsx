import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { AuthProvider } from './context/AuthContext';

import MapScreen from './screens/MapScreen';
import CommunityScreen from './screens/CommunityScreen';
import ContributeScreen from './screens/ContributeScreen';
import NotificationScreen from './screens/NotificationScreen';
import MyPageScreen from './screens/MyPageScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{icon}</Text>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarActiveTintColor: '#4285F4',
            tabBarInactiveTintColor: '#999',
            tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
            tabBarStyle: { height: 60, paddingTop: 4 },
            headerShown: false,
          }}
        >
          <Tab.Screen
            name="지도"
            component={MapScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="🗺️" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="커뮤니티"
            component={CommunityScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="💬" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="기여하기"
            component={ContributeScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="✏️" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="알림"
            component={NotificationScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="🔔" focused={focused} />,
            }}
          />
          <Tab.Screen
            name="마이페이지"
            component={MyPageScreen}
            options={{
              tabBarIcon: ({ focused }) => <TabIcon icon="👤" focused={focused} />,
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </AuthProvider>
  );
}
