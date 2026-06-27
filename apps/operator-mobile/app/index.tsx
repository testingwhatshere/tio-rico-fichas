import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';

const NAME_KEY = 'operator_name';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(NAME_KEY)
      .then((name) => {
        if (!active) return;
        setTarget(name && name.trim() ? '/(tabs)/dashboard' : '/wizard');
      })
      .catch(() => {
        if (!active) return;
        setTarget('/wizard');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!target) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={target as any} />;
}
