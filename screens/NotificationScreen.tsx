import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function NotificationScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>알림</Text>
      <Text style={styles.subtitle}>새로운 알림이 없습니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    color: '#999',
  },
});
