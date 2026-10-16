import { useLocalSearchParams, useRouter } from 'expo-router';
import FailureDetailView from '@/components/FailureDetailView';

/** Ruta a pantalla completa. La lógica vive en el componente, que además se
 *  embebe al lado de la bandeja en desktop. */
export default function FailureRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return <FailureDetailView id={id} onClose={() => router.back()} />;
}
