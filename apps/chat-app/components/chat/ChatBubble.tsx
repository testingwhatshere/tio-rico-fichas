import { View, Text, Image, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';
import AmountSelectorCard from '@/components/cards/AmountSelectorCard';
import PaymentDetailsCard from '@/components/cards/PaymentDetailsCard';
import ProofUploadCard from '@/components/cards/ProofUploadCard';
import StatusTrackerCard from '@/components/cards/StatusTrackerCard';
import GameLinkCard from '@/components/cards/GameLinkCard';
import PrizeAmountCard from '@/components/cards/PrizeAmountCard';
import PrizePaymentCard from '@/components/cards/PrizePaymentCard';
import PrizeClaimCard from '@/components/cards/PrizeClaimCard';

export interface InteractiveCard {
  type: 'AMOUNT_SELECTOR' | 'PAYMENT_DETAILS' | 'PROOF_UPLOAD' | 'STATUS_TRACKER' | 'GAME_LINK' | 'PRIZE_AMOUNT' | 'PRIZE_PAYMENT' | 'PRIZE_CLAIM';
  props: any;
  isDisabled?: boolean;
}

export interface Message {
  id: string;
  type: 'SYSTEM' | 'USER' | 'OPERATOR';
  content: string;
  imageUrl?: string;
  createdAt: string;
  senderId?: string;
  isRead?: boolean;
  interactiveCard?: InteractiveCard;
  sender?: {
    id: string;
    email: string;
    role: string;
    displayName?: string;
  };
}

interface ChatBubbleProps {
  message: Message;
  previousMessage?: Message;
}

function formatTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatBubble({ message, previousMessage }: ChatBubbleProps) {
  const isSystem = message.type === 'SYSTEM';
  const isUser = message.type === 'USER';
  const isOperator = message.type === 'OPERATOR';

  // Determine spacing: tighter between same-sender messages
  const sameSender = previousMessage?.type === message.type;
  const verticalMargin = sameSender ? 3 : 8;

  // System/Bot Message with Optional Interactive Card
  if (isSystem) {
    const hasImage = !!message.imageUrl;
    const hasCaption = hasImage && !!message.content;
    return (
      <View style={[styles.systemContainer, { marginVertical: verticalMargin }]}>
        {(message.content || hasImage) && (
          <View
            style={[
              styles.systemBubble,
              hasImage && styles.imageBubble,
              hasCaption && styles.imageBubbleWithCaption,
            ]}
          >
            {!hasImage && <Image source={require('@/assets/icon.png')} style={styles.systemIconImage} />}
            {hasImage && (
              <TouchableOpacity onPress={() => Linking.openURL(message.imageUrl!)} activeOpacity={0.8}>
                <Image
                  source={{ uri: message.imageUrl }}
                  style={styles.chatImage}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            )}
            {message.content ? (
              <Text style={[styles.systemText, hasImage && styles.systemCaption]}>
                {message.content}
              </Text>
            ) : null}
          </View>
        )}
        {(message.content || hasImage) && (
          <Text style={styles.systemTimestamp}>{formatTime(message.createdAt)}</Text>
        )}

        {/* Render Interactive Card */}
        {message.interactiveCard && renderInteractiveCard(message.interactiveCard)}
      </View>
    );
  }

  // User Message
  if (isUser) {
    const hasImage = !!message.imageUrl;
    const hasCaption = hasImage && !!message.content;
    return (
      <View style={[styles.userContainer, { marginVertical: verticalMargin }]}>
        <View
          style={[
            styles.userBubble,
            hasImage && styles.imageBubble,
            hasCaption && styles.imageBubbleWithCaption,
          ]}
        >
          {hasImage && (
            <TouchableOpacity onPress={() => Linking.openURL(message.imageUrl!)} activeOpacity={0.8}>
              <Image
                source={{ uri: message.imageUrl }}
                style={styles.chatImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )}
          {message.content ? <Text style={styles.userText}>{message.content}</Text> : null}
        </View>
        <View style={styles.userTimestampRow}>
          <Text style={styles.userTimestamp}>{formatTime(message.createdAt)}</Text>
          {!message.id.startsWith('temp-') && (
            <Text style={[
              styles.readTick,
              message.isRead && styles.readTickRead,
            ]}>
              {message.isRead ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // Operator Message
  if (isOperator) {
    return (
      <View style={[styles.operatorContainer, { marginVertical: verticalMargin }]}>
        <View style={styles.operatorIconCircle}>
          <Ionicons name="person" size={14} color={colors.primary} />
        </View>
        <View style={styles.operatorContent}>
          {!sameSender && (
            <Text style={styles.operatorLabel}>
              {message.sender?.displayName || 'Soporte'}
            </Text>
          )}
          <View
            style={[
              styles.operatorBubble,
              !!message.imageUrl && styles.imageBubble,
              !!message.imageUrl && !!message.content && styles.imageBubbleWithCaption,
            ]}
          >
            {message.imageUrl && (
              <TouchableOpacity onPress={() => Linking.openURL(message.imageUrl!)} activeOpacity={0.8}>
                <Image
                  source={{ uri: message.imageUrl }}
                  style={styles.chatImage}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            )}
            {message.content ? <Text style={styles.operatorText}>{message.content}</Text> : null}
          </View>
          <Text style={styles.operatorTimestamp}>{formatTime(message.createdAt)}</Text>
        </View>
      </View>
    );
  }

  return null;
}

function renderInteractiveCard(card: InteractiveCard) {
  const commonProps = { isDisabled: card.isDisabled };

  switch (card.type) {
    case 'AMOUNT_SELECTOR':
      return (
        <AmountSelectorCard {...commonProps} {...card.props} />
      );
    case 'PAYMENT_DETAILS':
      return (
        <PaymentDetailsCard {...commonProps} {...card.props} />
      );
    case 'PROOF_UPLOAD':
      return (
        <ProofUploadCard {...commonProps} {...card.props} />
      );
    case 'STATUS_TRACKER':
      return (
        <StatusTrackerCard {...card.props} />
      );
    case 'GAME_LINK':
      return (
        <GameLinkCard {...commonProps} {...card.props} />
      );
    case 'PRIZE_AMOUNT':
      return (
        <PrizeAmountCard {...commonProps} {...card.props} />
      );
    case 'PRIZE_PAYMENT':
      return (
        <PrizePaymentCard {...commonProps} {...card.props} />
      );
    case 'PRIZE_CLAIM':
      return (
        <PrizeClaimCard {...commonProps} {...card.props} />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  // System/Bot Message Styles
  systemContainer: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  systemBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 20, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    maxWidth: '85%',
    gap: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  systemIconImage: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  systemIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
  },
  systemText: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  systemCaption: {
    flex: 0,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  systemTimestamp: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },

  // User Message Styles
  userContainer: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
  },
  userBubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    maxWidth: '75%',
    backgroundColor: colors.primary,
  },
  userText: {
    fontSize: 15,
    color: colors.textOnPrimary,
    lineHeight: 20,
  },
  userTimestampRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    gap: 3,
    marginTop: 4,
    marginRight: 4,
  },
  userTimestamp: {
    fontSize: 11,
    color: colors.textMuted,
  },
  readTick: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700' as const,
    letterSpacing: -2,
  },
  readTickRead: {
    color: colors.accent,
  },

  // Operator Message Styles
  operatorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    maxWidth: '85%',
  },
  operatorIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  operatorContent: {
    flex: 1,
  },
  operatorLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 4,
    marginLeft: 4,
  },
  operatorBubble: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  operatorText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  operatorTimestamp: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    marginLeft: 4,
  },

  // Bubble override when it contains an image (image-only — no padding halo)
  imageBubble: {
    paddingHorizontal: 3,
    paddingVertical: 3,
    paddingTop: 3,
    paddingBottom: 3,
    minWidth: 220,
    overflow: 'hidden',
    // Force column so system bubbles (which default to row for icon+text)
    // stack image-above-caption instead of side-by-side.
    flexDirection: 'column',
    alignItems: 'center',
  },
  // Adds breathing room when image has a caption underneath
  imageBubbleWithCaption: {
    paddingHorizontal: 6,
    paddingBottom: 8,
  },

  // Chat image — fixed width avoids circular sizing with flex parents
  chatImage: {
    width: 220,
    height: 165,
    borderRadius: 13,
  },
});
