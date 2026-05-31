import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import {
  Post, Comment,
  getPosts, createPost, togglePostLike, getPostLiked,
  deletePost, getComments, addComment, deleteComment,
} from '../utils/database';
import {
  apiGetPosts, apiCreatePost, apiTogglePostLike, apiGetPostLiked,
  apiDeletePost, apiGetComments, apiAddComment, apiDeleteComment,
} from '../utils/api';

type Screen = 'list' | 'create' | 'detail';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

// ── 게시글 카드 ─────────────────────────────────────────────────────
function PostCard({
  post, onPress, currentUserId,
}: {
  post: Post;
  onPress: () => void;
  currentUserId: string;
}) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(post.likes);

  useEffect(() => {
    if (!currentUserId) return;
    apiGetPostLiked(post.id, currentUserId)
      .then(setLiked)
      .catch(() => getPostLiked(post.id, currentUserId).then(setLiked));
  }, [post.id, currentUserId]);

  const handleLike = async () => {
    if (!currentUserId) {
      Alert.alert('알림', '로그인 후 좋아요를 누를 수 있습니다.');
      return;
    }
    try {
      const result = await apiTogglePostLike(post.id, currentUserId);
      setLikes(result.likes);
      setLiked(result.liked);
    } catch {
      const result = await togglePostLike(post.id, currentUserId);
      setLikes(result.likes);
      setLiked(result.liked);
    }
  };

  const name = post.displayName || post.userEmail.split('@')[0] || '익명';
  const isCertified = (post as any).isCertified;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <View style={[styles.avatar, isCertified && { backgroundColor: '#F5A623' }]}>
          <Text style={styles.avatarText}>{isCertified ? '⭐' : (name[0]?.toUpperCase() ?? '?')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.cardAuthor}>{name}</Text>
            {isCertified && (
              <Text style={{ fontSize: 11, color: '#F5A623', fontWeight: '700' }}>인증됨</Text>
            )}
          </View>
          <Text style={styles.cardTime}>{timeAgo(post.createdAt)}</Text>
        </View>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{post.title}</Text>
      <Text style={styles.cardContent} numberOfLines={3}>{post.content}</Text>
      <View style={styles.cardFooter}>
        <TouchableOpacity style={styles.footerBtn} onPress={handleLike} activeOpacity={0.7}>
          <MaterialIcons
            name={liked ? 'favorite' : 'favorite-border'}
            size={16}
            color={liked ? '#e53935' : '#aaa'}
          />
          <Text style={[styles.footerCount, liked && { color: '#e53935' }]}>{likes}</Text>
        </TouchableOpacity>
        <View style={styles.footerBtn}>
          <MaterialIcons name="chat-bubble-outline" size={16} color="#aaa" />
          <Text style={styles.footerCount}>{post.commentCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── 댓글 아이템 ─────────────────────────────────────────────────────
function CommentItem({
  comment, currentUserId, onDelete,
}: {
  comment: Comment;
  currentUserId: string;
  onDelete: () => void;
}) {
  const name = comment.displayName || comment.userEmail.split('@')[0] || '익명';
  const isMine = Boolean(currentUserId && comment.userId === currentUserId);
  const isCertified = (comment as any).isCertified;

  return (
    <View style={styles.commentRow}>
      <View style={[styles.commentAvatar, isCertified && { backgroundColor: '#F5A623' }]}>
        <Text style={styles.commentAvatarText}>{isCertified ? '⭐' : (name[0]?.toUpperCase() ?? '?')}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.commentMeta}>
          <Text style={styles.commentAuthor}>{name}</Text>
          {isCertified && (
            <Text style={{ fontSize: 10, color: '#F5A623', fontWeight: '700' }}>인증됨</Text>
          )}
          <Text style={styles.commentTime}>{timeAgo(comment.createdAt)}</Text>
          {isMine && (
            <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="delete-outline" size={16} color="#ccc" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.commentContent}>{comment.content}</Text>
      </View>
    </View>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function CommunityScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<Screen>('list');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 글쓰기
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 상세
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const commentInputRef = useRef<TextInput>(null);

  const loadPosts = async () => {
    try {
      const data = await apiGetPosts();
      setPosts(data as Post[]);
    } catch {
      try {
        const data = await getPosts();
        setPosts(data);
      } catch {}
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (view === 'list') loadPosts();
    }, [view])
  );

  const loadComments = async (postId: number) => {
    setCommentLoading(true);
    try {
      const data = await apiGetComments(postId);
      setComments(data as Comment[]);
    } catch {
      try {
        const data = await getComments(postId);
        setComments(data);
      } catch {}
    } finally {
      setCommentLoading(false);
    }
  };

  const handleOpenPost = (post: Post) => {
    setSelectedPost(post);
    setComments([]);
    loadComments(post.id);
    setView('detail');
  };

  const handleSubmitPost = async () => {
    if (!user) {
      Alert.alert('알림', '로그인 후 글을 작성할 수 있습니다.');
      return;
    }
    if (!title.trim()) { Alert.alert('알림', '제목을 입력해주세요.'); return; }
    if (!content.trim()) { Alert.alert('알림', '내용을 입력해주세요.'); return; }

    setSubmitting(true);
    try {
      const certKey = await AsyncStorage.getItem('@flatroad/certified_key');
      let createdPost: Post | null = null;
      try {
        createdPost = await apiCreatePost(
          title.trim(), content.trim(),
          user.uid, user.email ?? '', user.displayName ?? '',
          certKey ?? ''
        ) as Post;
      } catch {
        await createPost(title.trim(), content.trim(), user.uid, user.email ?? '', user.displayName ?? '', !!certKey);
      }
      setTitle('');
      setContent('');
      setView('list');
      if (createdPost) {
        setPosts(prev => [
          createdPost,
          ...prev.filter(p => p.id !== createdPost.id),
        ]);
        setLoading(false);
        setRefreshing(false);
      } else {
        const localPosts = await getPosts();
        setPosts(localPosts);
        setLoading(false);
        setRefreshing(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePost = (post: Post) => {
    if (post.userId !== user?.uid) return;
    Alert.alert('삭제', '게시글을 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDeletePost(post.id, user!.uid);
          } catch {
            await deletePost(post.id);
          }
          setView('list');
          await loadPosts();
        },
      },
    ]);
  };

  const handleAddComment = async () => {
    if (!user) { Alert.alert('알림', '로그인 후 댓글을 달 수 있습니다.'); return; }
    if (!commentText.trim()) return;
    if (!selectedPost) return;
    const certKey = await AsyncStorage.getItem('@flatroad/certified_key');
    try {
      await apiAddComment(
        selectedPost.id, commentText.trim(),
        user.uid, user.email ?? '', user.displayName ?? '',
        certKey ?? ''
      );
    } catch {
      await addComment(
        selectedPost.id, commentText.trim(),
        user.uid, user.email ?? '', user.displayName ?? '',
        !!certKey
      );
    }
    setCommentText('');
    loadComments(selectedPost.id);
    // commentCount 업데이트
    setPosts(prev =>
      prev.map(p => p.id === selectedPost.id ? { ...p, commentCount: p.commentCount + 1 } : p)
    );
    setSelectedPost(prev => prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev);
  };

  const handleDeleteComment = async (comment: Comment) => {
    Alert.alert('삭제', '댓글을 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDeleteComment(comment.id, user!.uid);
          } catch {
            await deleteComment(comment.id);
          }
          if (selectedPost) {
            loadComments(selectedPost.id);
            setPosts(prev =>
              prev.map(p => p.id === selectedPost.id ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p)
            );
            setSelectedPost(prev => prev ? { ...prev, commentCount: Math.max(0, prev.commentCount - 1) } : prev);
          }
        },
      },
    ]);
  };

  // ── 글쓰기 화면 ─────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('list')} style={styles.headerBack}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>글쓰기</Text>
          <TouchableOpacity
            onPress={handleSubmitPost}
            disabled={submitting}
            style={[styles.headerAction, submitting && { opacity: 0.4 }]}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#4285F4" />
              : <Text style={styles.headerActionText}>등록</Text>
            }
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.titleInput}
              placeholder="제목을 입력하세요"
              placeholderTextColor="#bbb"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
            <View style={styles.divider} />
            <TextInput
              style={styles.contentInput}
              placeholder="내용을 입력하세요"
              placeholderTextColor="#bbb"
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── 상세 화면 ───────────────────────────────────────────────────
  if (view === 'detail' && selectedPost) {
    const authorName = selectedPost.displayName || selectedPost.userEmail.split('@')[0] || '익명';
    const isMine = user?.uid === selectedPost.userId;

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('list')} style={styles.headerBack}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>게시글</Text>
          {isMine && (
            <TouchableOpacity onPress={() => handleDeletePost(selectedPost)} style={styles.headerAction}>
              <MaterialIcons name="delete-outline" size={22} color="#e53935" />
            </TouchableOpacity>
          )}
          {!isMine && <View style={styles.headerAction} />}
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.bottom + 60}
        >
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {/* 본문 */}
            <View style={styles.detailBody}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{authorName[0]?.toUpperCase() ?? '?'}</Text>
                </View>
                <View>
                  <Text style={styles.cardAuthor}>{authorName}</Text>
                  <Text style={styles.cardTime}>{timeAgo(selectedPost.createdAt)}</Text>
                </View>
              </View>
              <Text style={styles.detailTitle}>{selectedPost.title}</Text>
              <Text style={styles.detailContent}>{selectedPost.content}</Text>
              <View style={[styles.cardFooter, { marginTop: 16 }]}>
                <View style={styles.footerBtn}>
                  <MaterialIcons name="favorite" size={16} color="#e53935" />
                  <Text style={styles.footerCount}>{selectedPost.likes}</Text>
                </View>
                <View style={styles.footerBtn}>
                  <MaterialIcons name="chat-bubble-outline" size={16} color="#aaa" />
                  <Text style={styles.footerCount}>{selectedPost.commentCount}</Text>
                </View>
              </View>
            </View>

            <View style={styles.commentSection}>
              <Text style={styles.commentSectionTitle}>
                댓글 {selectedPost.commentCount}개
              </Text>
              {commentLoading ? (
                <ActivityIndicator color="#4285F4" style={{ marginTop: 16 }} />
              ) : comments.length === 0 ? (
                <Text style={styles.noComment}>첫 댓글을 남겨보세요</Text>
              ) : (
                comments.map(c => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    currentUserId={user?.uid ?? ''}
                    onDelete={() => handleDeleteComment(c)}
                  />
                ))
              )}
            </View>
          </ScrollView>

          {/* 댓글 입력 */}
          <View style={[styles.commentBar, { paddingBottom: insets.bottom || 12 }]}>
            <TextInput
              ref={commentInputRef}
              style={styles.commentInput}
              placeholder={user ? '댓글을 입력하세요' : '로그인 후 댓글 작성 가능'}
              placeholderTextColor="#bbb"
              value={commentText}
              onChangeText={setCommentText}
              editable={!!user}
              maxLength={300}
              returnKeyType="send"
              onSubmitEditing={handleAddComment}
            />
            <TouchableOpacity
              style={[styles.commentSend, !commentText.trim() && { opacity: 0.3 }]}
              onPress={handleAddComment}
              disabled={!commentText.trim()}
            >
              <MaterialIcons name="send" size={20} color="#4285F4" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── 목록 화면 ───────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>커뮤니티</Text>
        <TouchableOpacity onPress={() => setView('create')} style={styles.headerAction}>
          <MaterialIcons name="edit" size={22} color="#4285F4" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4285F4" />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="forum" size={56} color="#e0e0e0" />
          <Text style={styles.emptyText}>첫 번째 게시글을 작성해보세요</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setView('create')}>
            <Text style={styles.emptyBtnText}>글쓰기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          onRefresh={() => { setRefreshing(true); loadPosts(); }}
          refreshing={refreshing}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={() => handleOpenPost(item)}
              currentUserId={user?.uid ?? ''}
            />
          )}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={() => setView('create')}
        activeOpacity={0.85}
      >
        <MaterialIcons name="edit" size={22} color="#fff" />
        <Text style={styles.fabText}>글쓰기</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerBack: { width: 36, alignItems: 'flex-start' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  headerAction: { width: 44, alignItems: 'flex-end' },
  headerActionText: { fontSize: 15, fontWeight: '700', color: '#4285F4' },

  listContent: { padding: 12, paddingBottom: 100 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#4285F4', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cardAuthor: { fontSize: 13, fontWeight: '600', color: '#333' },
  cardTime: { fontSize: 11, color: '#bbb', marginTop: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  cardContent: { fontSize: 13, color: '#666', lineHeight: 20 },
  cardFooter: { flexDirection: 'row', gap: 16, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f5f5f5' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerCount: { fontSize: 13, color: '#aaa', fontWeight: '600' },

  emptyText: { fontSize: 15, color: '#bbb', textAlign: 'center' },
  emptyBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: '#4285F4', borderRadius: 20,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  fab: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#4285F4',
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
    gap: 6,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // 글쓰기
  titleInput: {
    fontSize: 18, fontWeight: '600', color: '#1a1a1a',
    padding: 16, backgroundColor: '#fff',
  },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginHorizontal: 16 },
  contentInput: {
    fontSize: 15, color: '#333', lineHeight: 24,
    padding: 16, minHeight: 300, backgroundColor: '#fff',
  },

  // 상세
  detailBody: {
    backgroundColor: '#fff', padding: 16,
    borderBottomWidth: 8, borderBottomColor: '#f0f0f0',
  },
  detailTitle: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginBottom: 12 },
  detailContent: { fontSize: 15, color: '#444', lineHeight: 24 },

  // 댓글
  commentSection: { padding: 16 },
  commentSectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 12 },
  noComment: { fontSize: 13, color: '#ccc', textAlign: 'center', paddingVertical: 24 },

  commentRow: {
    flexDirection: 'row', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  commentAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#e8f0fe', justifyContent: 'center', alignItems: 'center',
  },
  commentAvatarText: { color: '#4285F4', fontWeight: '700', fontSize: 13 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  commentAuthor: { fontSize: 13, fontWeight: '600', color: '#333' },
  commentTime: { fontSize: 11, color: '#bbb', flex: 1 },
  commentContent: { fontSize: 13, color: '#555', lineHeight: 20 },

  commentBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  commentInput: {
    flex: 1, backgroundColor: '#f5f5f5', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    fontSize: 14, color: '#333', maxHeight: 80,
  },
  commentSend: { padding: 6 },
});
