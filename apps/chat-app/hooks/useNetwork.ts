import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface NetworkState {
  isConnected: boolean;
  isOffline: boolean;
  isInternetReachable: boolean | null;
  type: string | null;
}

export const useNetwork = (): NetworkState => {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isConnected: true,
    isOffline: false,
    isInternetReachable: null,
    type: null,
  });

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedHandler = (state: NetInfoState) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => handleNetworkChange(state), 500);
    };

    NetInfo.fetch().then(handleNetworkChange); // Initial fetch is immediate
    const unsubscribe = NetInfo.addEventListener(debouncedHandler);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, []);

  const handleNetworkChange = (state: NetInfoState) => {
    const isConnected = state.isConnected ?? false;
    const isInternetReachable = state.isInternetReachable ?? null;
    const isOffline = !isConnected || isInternetReachable === false;

    setNetworkState({
      isConnected,
      isOffline,
      isInternetReachable,
      type: state.type,
    });
  };

  return networkState;
};
