import { useLocalSearchParams, useRouter } from 'expo-router';
import PrizeDetailView from '@/components/PrizeDetailView';

export default function PrizeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return <PrizeDetailView id={id} onClose={() => router.back()} />;
}
