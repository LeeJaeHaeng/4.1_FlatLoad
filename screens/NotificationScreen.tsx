import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { apiGetDeleteNotifications, apiMarkNotificationRead, DeleteNotification } from '../utils/api';

export default function NotificationScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<DeleteNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    const data = await apiGetDeleteNotifications(user.uid);
    setNotifications(data);
    setLoading(false);
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRead = async (id: number) => {
    await apiMarkNotificationRead(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>알림</Text>
        {notifications.length > 0 && (
          <TouchableOpacity onPress={async () => {
            await Promise.all(notifications.map(n => apiMarkNotificationRead(n.id)));
            setNotifications([]);
          }}>
            <Text style={styles.allRead}>모두 읽음</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#F5A623" />
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="notifications-none" size={48} color="#ddd" />
          <Text style={styles.emptyText}>새로운 알림이 없습니다.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardIcon}>
                <MaterialIcons name="delete-outline" size={22} color="#e53935" />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>올린 이미지가 삭제되었습니다</Text>
                <Text style={styles.cardReason}>{item.reason}</Text>
                <Text style={styles.cardDate}>
                  {new Date(item.createdAt).toLocaleString('ko-KR')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleRead(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={18} color="#ccc" />
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  allRead: { fontSize: 13, color: '#4285F4', fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#bbb' },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fde8e8', alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  cardReason: { fontSize: 13, color: '#555' },
  cardDate: { fontSize: 11, color: '#bbb', marginTop: 2 },
});
