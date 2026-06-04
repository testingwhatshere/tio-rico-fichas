import React from 'react';
import { FlexWidget, TextWidget, IconWidget } from 'react-native-android-widget';
import { COLORS, STATUS_CONFIG } from './SharedStyles';

interface StatusWidgetProps {
  status?: string;
  amount?: string;
  targetUsername?: string;
}

// Widget 2: Status + Load button (2x2)
export function StatusWidget({ status, amount, targetUsername }: StatusWidgetProps) {
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
      {/* Header */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <IconWidget
          icon="ic_launcher"
          style={{ width: 28, height: 28 }}
        />
        <TextWidget
          text="Tio Rico"
          style={{
            fontSize: 15,
            fontWeight: '800',
            color: COLORS.accent,
          }}
        />
      </FlexWidget>

      {/* Status area */}
      {hasActiveRequest && statusInfo ? (
        <FlexWidget
          style={{
            backgroundColor: COLORS.backgroundLight,
            borderRadius: 10,
            padding: 10,
            gap: 4,
            flex: 1,
          }}
          clickAction="OPEN_CHAT"
        >
          <FlexWidget
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <TextWidget
              text={statusInfo.icon}
              style={{ fontSize: 14 }}
            />
            <TextWidget
              text={statusInfo.label}
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: statusInfo.color,
              }}
            />
          </FlexWidget>
          {amount && (
            <TextWidget
              text={`$${amount}`}
              style={{
                fontSize: 18,
                fontWeight: '800',
                color: COLORS.textPrimary,
              }}
            />
          )}
          {targetUsername && (
            <TextWidget
              text={targetUsername}
              style={{
                fontSize: 11,
                color: COLORS.textMuted,
              }}
            />
          )}
        </FlexWidget>
      ) : (
        <FlexWidget
          style={{
            backgroundColor: COLORS.backgroundLight,
            borderRadius: 10,
            padding: 10,
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <TextWidget
            text="Sin cargas activas"
            style={{
              fontSize: 12,
              color: COLORS.textMuted,
            }}
          />
        </FlexWidget>
      )}

      {/* Action button */}
      <FlexWidget
        style={{
          backgroundColor: COLORS.accent,
          borderRadius: 10,
          paddingVertical: 10,
          alignItems: 'center',
        }}
        clickAction="OPEN_LOAD"
      >
        <TextWidget
          text="Cargar Fichas"
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: COLORS.background,
          }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

export const StatusWidgetConfig = {
  name: 'Status',
  label: 'Estado + Cargar',
  description: 'Muestra el estado de tu carga y boton para cargar',
  minWidth: '180dp',
  minHeight: '180dp',
  previewImage: 'widget_preview_status',
};
