import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
} from 'react-native';
import colors from '@/constants/colors';

interface Message {
  id: string;
  content: string;
  type: 'USER' | 'OPERATOR' | 'SYSTEM';
  sender?: any;
  senderName?: string;
  imageUrl?: string;
  createdAt: string;
}

interface ChatBubbleProps {
  message: Message;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.78;

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '';
  }
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const time = formatTime(message.createdAt);

  // ---- SYSTEM messages: centered, no bubble ----
  if (message.type === 'SYSTEM') {
    return (
      <View style={styles.systemContainer}>
        <View style={styles.systemBubble}>
          <Text style={styles.systemText}>{message.content}</Text>
          {time ? <Text style={styles.systemTime}>{time}</Text> : null}
        </View>
      </View>
    );
  }

  const isOperator = message.type === 'OPERATOR';
  const senderName =
    message.senderName ||
    message.sender?.displayName ||
    message.sender?.username ||
    null;

  return (
    <View
      style={[
        styles.row,
        isOperator ? styles.rowRight : styles.rowLeft,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isOperator ? styles.bubbleOperator : styles.bubbleUser,
        ]}
      >
        {/* Sender name (operator only) */}
        {isOperator && senderName && (
          <Text style={styles.senderName}>{senderName}</Text>
        )}

        {/* Image attachment */}
        {message.imageUrl ? (
          <>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setImageModalVisible(true)}
            >
              <Image
                source={{ uri: message.imageUrl }}
                style={styles.image}
                resizeMode="cover"
              />
            </TouchableOpacity>

            {/* Fullscreen image modal */}
            <Modal
              visible={imageModalVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setImageModalVisible(false)}
            >
              <TouchableOpacity
                style={styles.imageModalOverlay}
                activeOpacity={1}
                onPress={() => setImageModalVisible(false)}
              >
                <Image
                  source={{ uri: message.imageUrl }}
                  style={styles.imageModalFull}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </Modal>
          </>
        ) : null}

        {/* Message content */}
        {message.content ? (
          <Text
            style={[
              styles.messageText,
              isOperator ? styles.messageTextOperator : styles.messageTextUser,
            ]}
          >
            {message.content}
          </Text>
        ) : null}

        {/* Timestamp */}
        {time ? (
          <Text
            style={[
              styles.time,
              isOperator ? styles.timeOperator : styles.timeUser,
            ]}
          >
            {time}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Layout rows
  row: {
    marginVertical: 3,
    paddingHorizontal: 12,
  },
  rowLeft: {
    alignItems: 'flex-start',
  },
  rowRight: {
    alignItems: 'flex-end',
  },

  // Bubble base
  bubble: {
    maxWidth: MAX_BUBBLE_WIDTH,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: colors.backgroundTertiary,
    borderTopLeftRadius: 4,
  },
  bubbleOperator: {
    backgroundColor: colors.primaryDark,
    borderTopRightRadius: 4,
  },

  // Sender name
  senderName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textOnPrimary,
    marginBottom: 3,
    opacity: 0.85,
  },

  // Message text
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextUser: {
    color: colors.textPrimary,
  },
  messageTextOperator: {
    color: colors.textOnPrimary,
  },

  // Timestamp
  time: {
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeUser: {
    color: colors.textMuted,
  },
  timeOperator: {
    color: 'rgba(26, 32, 44, 0.55)',
  },

  // System messages
  systemContainer: {
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 24,
  },
  systemBubble: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: MAX_BUBBLE_WIDTH,
  },
  systemText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  systemTime: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 3,
    opacity: 0.6,
  },

  // Image
  image: {
    width: MAX_BUBBLE_WIDTH - 28,
    height: 180,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: colors.backgroundSecondary,
  },

  // Image modal
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalFull: {
    width: SCREEN_WIDTH - 24,
    height: SCREEN_WIDTH - 24,
  },
});
