import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AuthProvider } from './context/AuthContext';

import MapScreen from './screens/MapScreen';
import CommunityScreen from './screens/CommunityScreen';
import ContributeScreen from './screens/ContributeScreen';
import NotificationScreen from './screens/NotificationScreen';
import MyPageScreen from './screens/MyPageScreen';

const Tab = createBottomTabNavigator();

const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#AAAAAA';

type TabIconName = 'place' | 'group' | 'add-location-alt' | 'notifications' | 'person';

function TabIcon({
  name,
  focused,
  label,
}: {
  name: TabIconName;
  focused: boolean;
  label: string;
}) {
  return (
    <View style={tabStyles.wrapper}>
      {/* 상단 인디케이터 */}
      {focused && <View style={tabStyles.indicator} />}
      <MaterialIcons
        name={name}
        size={23}
        color={focused ? ACTIVE_COLOR : INACTIVE_COLOR}
      />
      <Text style={[tabStyles.label, { color: focused ? ACTIVE_COLOR : INACTIVE_COLOR }]}>
        {label}
      </Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 0,
    gap: 3,
    width: 64,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: ACTIVE_COLOR,
  },
});

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarStyle: {
              borderTopWidth: 1,
              borderTopColor: '#EBEBEB',
              backgroundColor: '#fff',
              elevation: 10,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
              height: 62,
              paddingBottom: 6,
            },
            tabBarShowLabel: false,
            headerShown: false,
          }}
        >
          <Tab.Screen
            name="지도"
            component={MapScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="place" focused={focused} label="지도" />
              ),
            }}
          />
          <Tab.Screen
            name="커뮤니티"
            component={CommunityScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="group" focused={focused} label="커뮤니티" />
              ),
            }}
          />
          <Tab.Screen
            name="기여하기"
            component={ContributeScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="add-location-alt" focused={focused} label="기여하기" />
              ),
            }}
          />
          <Tab.Screen
            name="알림"
            component={NotificationScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="notifications" focused={focused} label="알림" />
              ),
            }}
          />
          <Tab.Screen
            name="마이페이지"
            component={MyPageScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon name="person" focused={focused} label="마이페이지" />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </AuthProvider>
  );
}
