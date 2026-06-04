import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { QuickLoadWidget } from './QuickLoadWidget';
import { StatusWidget } from './StatusWidget';
import { DashboardWidget } from './DashboardWidget';

// AsyncStorage key used by the app to sync widget data
export const WIDGET_DATA_KEY = '@tiorico:widget_data';

interface WidgetData {
  status?: string;
  amount?: string;
  targetUsername?: string;
  lastMessage?: string;
}

async function getWidgetData(): Promise<WidgetData> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_DATA_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetInfo = props.widgetInfo;
  const widgetAction = props.widgetAction;

  // Handle click actions
  if (widgetAction === 'WIDGET_CLICK') {
    const clickAction = props.clickAction;

    switch (clickAction) {
      case 'OPEN_LOAD':
        await Linking.openURL('tioricofichas:///chat?action=load');
        break;
      case 'OPEN_PRIZE':
        await Linking.openURL('tioricofichas:///chat?action=prize');
        break;
      case 'OPEN_CHAT':
        await Linking.openURL('tioricofichas:///chat');
        break;
      default:
        await Linking.openURL('tioricofichas:///home');
    }
    return;
  }

  // Handle widget rendering (initial + updates)
  if (widgetAction === 'WIDGET_ADDED' || widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_RESIZED') {
    const data = await getWidgetData();

    switch (widgetInfo.widgetName) {
      case 'QuickLoad':
        props.renderWidget(<QuickLoadWidget />);
        break;
      case 'Status':
        props.renderWidget(
          <StatusWidget
            status={data.status}
            amount={data.amount}
            targetUsername={data.targetUsername}
          />,
        );
        break;
      case 'Dashboard':
        props.renderWidget(
          <DashboardWidget
            status={data.status}
            amount={data.amount}
            targetUsername={data.targetUsername}
            lastMessage={data.lastMessage}
          />,
        );
        break;
    }
  }
}
