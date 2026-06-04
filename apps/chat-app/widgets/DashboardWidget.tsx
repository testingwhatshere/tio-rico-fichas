import React from 'react';
import { FlexWidget, TextWidget, IconWidget } from 'react-native-android-widget';
import { COLORS, STATUS_CONFIG } from './SharedStyles';

interface DashboardWidgetProps {
  status?: string;
  amount?: string;
  targetUsername?: string;
  lastMessage?: string;
}

// Widget 3: Mini Dashboard (4x2)
export function DashboardWidget({ status, amount, targetUsername, lastMessage }: DashboardWidgetProps) {
  const hasActiveRequest = !!status && status !== 'COMPLETED' && status !== 'REJECTED' && status !== 'CANCELLED';
  const statusInfo = status ? STATUS_CONFIG[status] : null;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: COLORS.background,
        borderRadius: 16,
        padding: 14,
        gap: 8,
      }}
    >
      {/* Header row */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconWidget
            icon="ic_launcher"
            style={{ width: 24, height: 24 }}
          />
          <TextWidget
            text="Tio Rico Fichas"
            style={{
              fontSize: 14,
              fontWeight: '800',
              color: COLORS.accent,
            }}
          />
        </FlexWidget>
      </FlexWidget>

      {/* Content: Status + Last message */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          gap: 8,
          flex: 1,
        }}
      >
        {/* Status card (left) */}
        <FlexWidget
          style={{
            backgroundColor: COLORS.backgroundLight,
            borderRadius: 10,
            padding: 10,
            flex: 1,
            gap: 4,
          }}
          clickAction="OPEN_CHAT"
        >
          {hasActiveRequest && statusInfo ? (
            <>
              <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TextWidget text={statusInfo.icon} style={{ fontSize: 12 }} />
                <TextWidget
                  text={statusInfo.label}
                  style={{ fontSize: 11, fontWeight: '600', color: statusInfo.color }}
                />
              </FlexWidget>
              {amount && (
                <TextWidget
                  text={`$${amount}`}
                  style={{ fontSize: 20, fontWeight: '800', color: COLORS.textPrimary }}
                />
              )}
              {targetUsername && (
                <TextWidget
                  text={targetUsername}
                  style={{ fontSize: 10, color: COLORS.textMuted }}
                />
              )}
            </>
          ) : (
            <>
              <TextWidget
                text="Sin cargas"
                style={{ fontSize: 12, color: COLORS.textMuted }}
              />
              <TextWidget
                text="activas"
                style={{ fontSize: 12, color: COLORS.textMuted }}
              />
            </>
          )}
        </FlexWidget>

        {/* Last message card (right) */}
        <FlexWidget
          style={{
            backgroundColor: COLORS.backgroundLight,
            borderRadius: 10,
            padding: 10,
            flex: 1,
            gap: 4,
          }}
          clickAction="OPEN_CHAT"
        >
          <TextWidget
            text="Ultimo mensaje"
            style={{ fontSize: 10, fontWeight: '600', color: COLORS.textMuted }}
          />
          <TextWidget
            text={lastMessage || 'Sin mensajes'}
            style={{
              fontSize: 11,
              color: lastMessage ? COLORS.textSecondary : COLORS.textMuted,
            }}
            truncate="END"
            maxLines={3}
          />
        </FlexWidget>
      </FlexWidget>

      {/* Action buttons row */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          gap: 8,
        }}
      >
        <FlexWidget
          style={{
            backgroundColor: COLORS.accent,
            borderRadius: 10,
            paddingVertical: 10,
            flex: 1,
            alignItems: 'center',
          }}
          clickAction="OPEN_LOAD"
        >
          <TextWidget
            text="Cargar Fichas"
            style={{ fontSize: 13, fontWeight: '700', color: COLORS.background }}
          />
        </FlexWidget>

        <FlexWidget
          style={{
            backgroundColor: COLORS.backgroundLight,
            borderRadius: 10,
            paddingVertical: 10,
            flex: 1,
            alignItems: 'center',
            borderColor: COLORS.border,
            borderWidth: 1,
          }}
          clickAction="OPEN_PRIZE"
        >
          <TextWidget
            text="Cobrar Premio"
            style={{ fontSize: 13, fontWeight: '600', color: COLORS.accent }}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

export const DashboardWidgetConfig = {
  name: 'Dashboard',
  label: 'Mini Dashboard',
  description: 'Estado, ultimo mensaje, cargar fichas y cobrar premio',
  minWidth: '300dp',
  minHeight: '180dp',
  previewImage: 'widget_preview_dashboard',
};
