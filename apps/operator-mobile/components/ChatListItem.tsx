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
  const needsHelp: boolean = !!chat.needsHelp;
  const helpContextLabel = chat.helpContext === 'prize' ? 'premio' : 'chat';

  return (
    <TouchableOpacity
      style={[styles.container, needsHelp && styles.containerHelp]}
      onPress={onPress}
      activeOpacity={0.65}
    >
      {needsHelp && <View style={styles.helpBar} />}
      {/* Avatar area with online indicator */}
      <View style={styles.avatarContainer}>
        <View style={[styles.avatar, needsHelp && styles.avatarHelp]}>
          <Text style={styles.avatarText}>
            {username.charAt(0).toUpperCase()}
          </Text>
        </View>
        {isOnline && <View style={styles.onlineDot} />}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {needsHelp && (
          <View style={styles.helpBadge}>
            <Text style={styles.helpBadgeText}>🙋 AYUDA · {helpContextLabel}</Text>
          </View>
        )}
        <View style={styles.topRow}>
          <Text
            style={[
              styles.username,
              unreadCount > 0 && styles.usernameUnread,
              needsHelp && styles.usernameHelp,
            ]}
            numberOfLines={1}
          >
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
  containerHelp: {
    backgroundColor: 'rgba(245, 101, 101, 0.08)',
  },
  helpBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.error,
  },
  avatarHelp: {
    borderWidth: 2,
    borderColor: colors.error,
  },
  helpBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.error,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  helpBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  usernameHelp: {
    color: colors.error,
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
