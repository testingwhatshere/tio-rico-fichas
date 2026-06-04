/**
 * useNetwork - Web (navigator.onLine)
 *
 * Uses browser online/offline events instead of @react-native-community/netinfo.
 * Metro resolves this file on web instead of useNetwork.ts.
 */

import { useEffect, useState } from 'react';

interface NetworkState {
  isConnected: boolean;
  isOffline: boolean;
  isInternetReachable: boolean | null;
  type: string | null;
}

export const useNetwork = (): NetworkState => {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isConnected: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    isInternetReachable: typeof navigator !== 'undefined' ? navigator.onLine : null,
    type: 'unknown',
  });

  useEffect(() => {
    const handleOnline = () => {
      setNetworkState({
        isConnected: true,
        isOffline: false,
        isInternetReachable: true,
        type: 'unknown',
      });
    };

    const handleOffline = () => {
      setNetworkState({
        isConnected: false,
        isOffline: true,
        isInternetReachable: false,
        type: 'none',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return networkState;
};
