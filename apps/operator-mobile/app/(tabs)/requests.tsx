import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { emitWithTimeout } from '@/services/socket';
import { formatAmount, parseAmount } from '@/utils/amount';
import { toast } from '@/components/Toast';
import StatusBadge from '@/components/StatusBadge';

const PAGE_SIZE = 50;

interface Request {
  id: string;
  status: string;
  amount: string | number;
  targetUsername?: string | null;
  createdAt: string;
  user?: { id?: string; email?: string | null; username?: string | null } | null;
}

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'PENDING_PROOF', label: 'Esperando' },
  { key: 'VALIDATING', label: 'Validando' },
  { key: 'APPROVED', label: 'Aprobados' },
  { key: 'PROCESSING', label: 'Procesando' },
  { key: 'COMPLETED', label: 'Completados' },
  { key: 'FAILED', label: 'Fallidos' },
  { key: 'REJECTED', label: 'Rechazados' },
];

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d || isNaN(d)) return '-';
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function RequestsScreen() {
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (targetPage === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const params: { limit: number; offset: number; status?: string } = {
          limit: PAGE_SIZE,
          offset: targetPage * PAGE_SIZE,
        };
        if (filter !== 'all') params.status = filter;
        const result = await emitWithTimeout<any>('get_requests', params);
        const list: Request[] = result?.data || result?.requests || (Array.isArray(result) ? result : []);
        if (!Array.isArray(list)) throw new Error('Respuesta invalida del servidor');
        setHasMore(list.length === PAGE_SIZE);
        setRequests((prev) => (replace ? list : [...prev, ...list]));
        setPage(targetPage);
      } catch (err: any) {
        toast.error(err?.message || 'No se pudieron cargar las solicitudes');
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    loadPage(0, true);
  }, [loadPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadPage(0, true);
  }, [loadPage]);

  const onEndReached = useCallback(() => {
    if (!loadingMore && !loading && hasMore) {
      loadPage(page + 1, false);
    }
  }, [loadingMore, loading, hasMore, page, loadPage]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => {
      const u = (r.targetUsername || '').toLowerCase();
      const email = (r.user?.email || '').toLowerCase();
      const id = (r.id || '').toLowerCase();
      return u.includes(q) || email.includes(q) || id.includes(q);
    });
  }, [requests, search]);

  const renderItem = useCallback(({ item }: { item: Request }) => {
    const username = item.targetUsername || item.user?.username || 'N/A';
    const email = item.user?.email || '';
    const shortId = (item.id || '').slice(-6);
    const amt = parseAmount(item.amount);
    return (
      <View style={styles.item}>
        <View style={styles.itemTop}>
          <View style={styles.itemTopLeft}>
            <Text style={styles.username} numberOfLines={1}>
              {username}
            </Text>
            {email ? <Text style={styles.email} numberOfLines={1}>{email}</Text> : null}
          </View>
          <Text style={styles.amount}>${formatAmount(amt)}</Text>
        </View>
        <View style={styles.itemBottom}>
          <StatusBadge status={item.status} size="sm" />
          <View style={styles.itemMeta}>
            <Text style={styles.metaText}>#{shortId}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>
      </View>
    );
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Solicitudes</Text>
        <Text style={styles.subtitle}>Historial completo</Text>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          placeholder="Buscar por usuario, email o ID"
          placeholderTextColor={colors.placeholder}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="documents-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>Sin solicitudes</Text>
            </View>
          }
          onEndReachedThreshold={0.4}
          onEndReached={onEndReached}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} /> : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 20,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 2,
  },
  filterScroll: {
    flexGrow: 0,
    marginTop: 10,
  },
  filterRow: {
    paddingHorizontal: 16,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primaryGlow,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: colors.primary,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 100,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  item: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  itemTopLeft: {
    flex: 1,
    marginRight: 12,
  },
  username: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  email: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  amount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  itemBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  metaDot: {
    color: colors.textMuted,
  },
});
