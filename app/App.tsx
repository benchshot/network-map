import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { API_URL, api, timeAgo, type DeviceEdit } from './src/api';
import { useTheme } from './src/theme';
import { NetworkGraph } from './src/components/NetworkGraph';
import { DeviceList, matches, type Filter } from './src/components/DeviceList';
import { DeviceDetail } from './src/components/DeviceDetail';
import type { Snapshot } from './src/types';

export default function App() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
      setError(undefined);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, snapshot?.scanning ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [refresh, snapshot?.scanning]);

  // Keeps "last scan 3 min ago" labels current between polls.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const startScan = async () => {
    await api.scan().catch(() => undefined);
    refresh();
  };

  const edit = async (id: string, change: DeviceEdit) => {
    const updated = await api.edit(id, change);
    setSnapshot((s) => s && { ...s, devices: s.devices.map((d) => (d.id === id ? updated : d)) });
  };

  const forget = async (id: string) => {
    await api.forget(id);
    setSelectedId(undefined);
    refresh();
  };

  const matchingIds = useMemo(() => {
    if (!snapshot || (!query && filter === 'all')) return undefined;
    return new Set(snapshot.devices.filter((d) => matches(d, query, filter)).map((d) => d.id));
  }, [snapshot, query, filter]);

  const selected = snapshot?.devices.find((d) => d.id === selectedId);
  const parent = useMemo(() => {
    const link = snapshot?.links.find((l) => l.target === selectedId);
    return link ? snapshot?.devices.find((d) => d.id === link.source) : undefined;
  }, [snapshot, selectedId]);

  const wide = width >= 1100;
  const medium = width >= 760;
  const online = snapshot?.devices.filter((d) => d.online).length ?? 0;
  const fresh = snapshot?.devices.filter((d) => !d.acknowledged).length ?? 0;

  const list = snapshot ? (
    <DeviceList
      devices={snapshot.devices}
      theme={theme}
      query={query}
      filter={filter}
      selectedId={selectedId}
      onQuery={setQuery}
      onFilter={setFilter}
      onSelect={setSelectedId}
    />
  ) : null;

  const detail =
    selected && snapshot ? (
      <DeviceDetail
        key={selected.id}
        device={selected}
        parent={parent}
        theme={theme}
        onEdit={(change) => edit(selected.id, change)}
        onForget={() => forget(selected.id)}
        onSelect={setSelectedId}
        onClose={() => setSelectedId(undefined)}
      />
    ) : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.page }]}>
      <StatusBar style="auto" />
      <View style={[styles.header, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <MaterialCommunityIcons name="lan" size={22} color={theme.accent} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: theme.text }]}>Network Map</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {snapshot
              ? `${online} online · ${(snapshot.devices.length ?? 0) - online} offline${fresh ? ` · ${fresh} new` : ''}${snapshot.subnet ? ` · ${snapshot.subnet}` : ''}`
              : 'Connecting to scanner…'}
          </Text>
        </View>
        {snapshot?.routers.map((r) => (
          <View key={r.name} style={[styles.routerPill, { borderColor: r.ok ? theme.good : theme.critical }]}>
            <MaterialCommunityIcons name={r.ok ? 'check-circle' : 'alert-circle'} size={12} color={r.ok ? theme.good : theme.critical} />
            <Text style={[styles.routerText, { color: theme.textSecondary }]}>{r.name}</Text>
          </View>
        ))}
        {medium && snapshot ? (
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            {snapshot.scanning ? (snapshot.scanStage ?? 'Scanning…') : `Scanned ${timeAgo(snapshot.lastScanAt)}`}
          </Text>
        ) : null}
        <Pressable
          onPress={startScan}
          disabled={!snapshot || snapshot.scanning}
          style={[styles.scanButton, { backgroundColor: theme.accent, opacity: !snapshot || snapshot.scanning ? 0.6 : 1 }]}
        >
          {snapshot?.scanning ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialCommunityIcons name="radar" size={16} color="#fff" />
          )}
          <Text style={styles.scanText}>{snapshot?.scanning ? 'Scanning' : 'Scan now'}</Text>
        </Pressable>
      </View>

      {snapshot?.warnings.map((w) => (
        <View key={w} style={[styles.banner, { borderColor: theme.warning, backgroundColor: theme.surface }]}>
          <MaterialCommunityIcons name="alert-outline" size={16} color={theme.warning} />
          <Text style={[styles.bannerText, { color: theme.text }]}>{w}</Text>
        </View>
      ))}
      {snapshot?.routers
        .filter((r) => !r.ok)
        .map((r) => (
          <View key={r.name} style={[styles.banner, { borderColor: theme.critical, backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={theme.critical} />
            <Text style={[styles.bannerText, { color: theme.text }]}>
              {r.name}: {r.error}
            </Text>
          </View>
        ))}

      {!snapshot ? (
        <View style={styles.center}>
          {error ? (
            <>
              <MaterialCommunityIcons name="lan-disconnect" size={40} color={theme.muted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>Can't reach the scanner at {API_URL}</Text>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Start it with `npm start` in network-map/server, then this page reconnects on its own.
              </Text>
            </>
          ) : (
            <ActivityIndicator color={theme.accent} />
          )}
        </View>
      ) : !snapshot.devices.length ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Running the first scan…</Text>
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{snapshot.scanStage}</Text>
        </View>
      ) : medium ? (
        <View style={styles.body}>
          <View style={[styles.sidebar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            {!wide && detail ? detail : list}
          </View>
          <View style={styles.graph}>
            <NetworkGraph snapshot={snapshot} theme={theme} selectedId={selectedId} matchingIds={matchingIds} onSelect={setSelectedId} />
          </View>
          {wide && detail ? (
            <View style={[styles.detail, { borderColor: theme.border, backgroundColor: theme.surface }]}>{detail}</View>
          ) : null}
        </View>
      ) : (
        <View style={styles.stack}>
          <View style={[styles.graphNarrow, { borderColor: theme.border }]}>
            <NetworkGraph snapshot={snapshot} theme={theme} selectedId={selectedId} matchingIds={matchingIds} onSelect={setSelectedId} />
          </View>
          <View style={[styles.panelNarrow, { backgroundColor: theme.surface }]}>{detail ?? list}</View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, height: '100%' as never },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 12 },
  routerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  routerText: { fontSize: 11, fontWeight: '600' },
  scanButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  scanText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  banner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  sidebar: { width: 320, borderRightWidth: 1, padding: 14 },
  graph: { flex: 1 },
  detail: { width: 380, borderLeftWidth: 1, padding: 16 },
  stack: { flex: 1, minHeight: 0 },
  graphNarrow: { height: 380, borderBottomWidth: 1 },
  panelNarrow: { flex: 1, padding: 16, minHeight: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center', maxWidth: 420 },
});
