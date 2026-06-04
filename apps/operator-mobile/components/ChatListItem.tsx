import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import colors from '@/constants/colors';

interface ChatListItemProps {
  chat: any;
  onPress: () => void;
}

/**
 * Format a date as a relative time string.
 * - Less than 1 min: "ahora"
 * - Less than 1 hour: "Xm"
 * - Less than 24 hours: "Xh"
 * - Otherwise: "DD/MM"
 */
function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';

  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;

  if (diffMs < 0) return 'ahora';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/**
 * Truncate a string to maxLen characters, adding "..." if needed.
 */
function truncate(text: string | undefined | null, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export default function ChatListItem({ chat, onPress }: ChatListItemProps) {
  const username = chat.user?.username || chat.user?.email || 'Usuario';
  const lastMessage = chat.lastMessage?.content || chat.lastMessage?.text;
  const preview = truncate(lastMessage, 50);
  const timestamp = formatRelativeTime(chat.updatedAt || chat.lastMessage?.createdAt);
  const unreadCount: number = chat.unreadCount || 0;
  const isOnline: boolean = chat.user?.isOnline === true;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.65}
    >
      {/* Avatar area with online indicator */}
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {username.charAt(0).toUpperCase()}
          </Text>
        </View>
        {isOnline && <View style={styles.onlineDot} />}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={[styles.username, unreadCount > 0 && styles.usernameUnread]} numberOfLines={1}>
            {username}
          </Text>
          <Text style={[styles.timestamp, unreadCount > 0 && styles.timestampUnread]}>
            {timestamp}
          </Text>
        </View>
        <View style={styles.bottomRow}>
          <Text
            style={[styles.preview, unreadCount > 0 && styles.previewUnread]}
            numberOfLines={1}
          >
            {preview || 'Sin mensajes'}
          </Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.onlineGreen,
    borderWidth: 2.5,
    borderColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  username: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  usernameUnread: {
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 12,
    color: colors.textMuted,
  },
  timestampUnread: {
    color: colors.primary,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  preview: {
    fontSize: 14,
    color: colors.textMuted,
    flex: 1,
    marginRight: 8,
  },
  previewUnread: {
    color: colors.textSecondary,
    fontWeight: '500',
  },
  badge: {
    backgroundColor: colors.unreadBadge,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
});
