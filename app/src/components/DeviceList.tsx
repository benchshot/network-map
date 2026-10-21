import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { displayName } from '../api';
import { GROUP_LABELS, GROUP_ORDER, KINDS, type Theme } from '../theme';
import type { Device } from '../types';

export type Filter = 'all' | 'online' | 'new' | 'offline';

interface Props {
  devices: Device[];
  theme: Theme;
  query: string;
  filter: Filter;
  selectedId?: string;
  onQuery(q: string): void;
  onFilter(f: Filter): void;
  onSelect(id: string): void;
}

export function matches(d: Device, query: string, filter: Filter): boolean {
  if (filter === 'online' && !d.online) return false;
  if (filter === 'offline' && d.online) return false;
  if (filter === 'new' && d.acknowledged) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    displayName(d),
    d.hostname,
    d.ip,
    d.mac,
    d.vendor,
    d.owner,
    d.notes,
    KINDS[d.kind].label,
    ...d.ports.map((p) => p.service),
    ...d.mdnsServices,
  ]
    .filter(Boolean)
    .some((field) => field!.toLowerCase().includes(q));
}

export function DeviceList({ devices, theme, query, filter, selectedId, onQuery, onFilter, onSelect }: Props) {
  const counts: Record<Filter, number> = {
    all: devices.length,
    online: devices.filter((d) => d.online).length,
    new: devices.filter((d) => !d.acknowledged).length,
    offline: devices.filter((d) => !d.online).length,
  };
  const visible = devices.filter((d) => matches(d, query, filter));

  return (
    <View style={styles.root}>
      <View style={[styles.search, { backgroundColor: theme.raised, borderColor: theme.border }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search name, IP, vendor, service…"
          placeholderTextColor={theme.muted}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {query ? (
          <Pressable onPress={() => onQuery('')} accessibilityLabel="Clear search">
            <MaterialCommunityIcons name="close-circle" size={16} color={theme.muted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filters}>
        {(['all', 'online', 'new', 'offline'] as Filter[]).map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => onFilter(f)}
              style={[
                styles.chip,
                { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent : 'transparent' },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#fff' : theme.textSecondary }]}>
                {f[0].toUpperCase() + f.slice(1)} {counts[f]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 16 }}>
        {GROUP_ORDER.map((group) => {
          const items = visible
            .filter((d) => KINDS[d.kind].group === group)
            .sort((a, b) => Number(b.online) - Number(a.online) || displayName(a).localeCompare(displayName(b)));
          if (!items.length) return null;
          return (
            <View key={group} style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={[styles.groupSwatch, { borderColor: theme.groups[group] }]} />
                <Text style={[styles.groupTitle, { color: theme.textSecondary }]}>
                  {GROUP_LABELS[group]} · {items.length}
                </Text>
              </View>
              {items.map((d) => {
                const selected = d.id === selectedId;
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => onSelect(d.id)}
                    style={(state) => [
                      styles.row,
                      {
                        backgroundColor: selected ? theme.raised : (state as { hovered?: boolean }).hovered ? theme.page : 'transparent',
                        borderColor: selected ? theme.border : 'transparent',
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name={KINDS[d.kind].icon as never} size={18} color={theme.groups[group]} />
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={[styles.rowName, { color: theme.text, opacity: d.online ? 1 : 0.6 }]}>
                        {d.isSelf ? `${displayName(d)} (this Mac)` : displayName(d)}
                      </Text>
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.muted }]}>
                        {[
                          d.ip,
                          d.ports
                            .slice(0, 3)
                            .map((p) => p.service)
                            .join(', '),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    {!d.acknowledged ? (
                      <View style={[styles.newBadge, { backgroundColor: theme.warning }]}>
                        <Text style={styles.newText}>NEW</Text>
                      </View>
                    ) : null}
                    <View
                      style={[styles.dot, { backgroundColor: d.online ? theme.good : theme.muted }]}
                      accessibilityLabel={d.online ? 'online' : 'offline'}
                    />
                  </Pressable>
                );
              })}
            </View>
          );
        })}
        {!visible.length ? <Text style={[styles.empty, { color: theme.muted }]}>No devices match.</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, height: 36 },
  searchInput: { flex: 1, fontSize: 14, outlineStyle: 'none' } as never,
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '600' },
  list: { flex: 1, marginTop: 10 },
  group: { marginTop: 10 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, paddingHorizontal: 4 },
  groupSwatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  groupTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: '500' },
  rowMeta: { fontSize: 12, marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  newBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  newText: { fontSize: 9, fontWeight: '800', color: '#0b0b0b', letterSpacing: 0.5 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 13 },
});
