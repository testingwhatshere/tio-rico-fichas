import React from 'react';
import { FlexWidget, TextWidget, IconWidget } from 'react-native-android-widget';
import { COLORS } from './SharedStyles';

// Widget 1: Simple "Cargar Fichas" button (2x1)
export function QuickLoadWidget() {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.background,
        borderRadius: 16,
        padding: 12,
        gap: 10,
      }}
      clickAction="OPEN_LOAD"
    >
      <IconWidget
        icon="ic_launcher"
        style={{ width: 36, height: 36 }}
      />
      <FlexWidget
        style={{
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <TextWidget
          text="Tio Rico"
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: COLORS.accent,
          }}
        />
        <TextWidget
          text="Cargar Fichas"
          style={{
            fontSize: 12,
            color: COLORS.textSecondary,
          }}
        />
      </FlexWidget>
      <FlexWidget
        style={{
          backgroundColor: COLORS.accent,
          borderRadius: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
          marginLeft: 'auto' as any,
        }}
        clickAction="OPEN_LOAD"
      >
        <TextWidget
          text="Cargar"
          style={{
            fontSize: 13,
            fontWeight: '700',
            color: COLORS.background,
          }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

export const QuickLoadWidgetConfig = {
  name: 'QuickLoad',
  label: 'Cargar Fichas',
  description: 'Boton rapido para cargar fichas',
  minWidth: '200dp',
  minHeight: '60dp',
  previewImage: 'widget_preview_quickload',
};
