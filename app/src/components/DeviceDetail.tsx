import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { displayName, formatBytes, timeAgo, type DeviceEdit } from '../api';
import { KIND_ORDER, KINDS, type Theme } from '../theme';
import type { Device } from '../types';

const WEB_PORTS: Record<number, string> = {
  80: 'http',
  443: 'https',
  3000: 'http',
  5000: 'http',
  5001: 'https',
  8080: 'http',
  8123: 'http',
  8443: 'https',
  8888: 'http',
  9000: 'http',
  32400: 'http',
};

interface Props {
  device: Device;
  parent?: Device;
  theme: Theme;
  onEdit(edit: DeviceEdit): void;
  onForget(): void;
  onSelect(id: string): void;
  onClose(): void;
}

function Field({
  label,
  value,
  theme,
  onCommit,
  multiline,
}: {
  label: string;
  value?: string;
  theme: Theme;
  onCommit(v: string): void;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.muted }]}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => draft !== (value ?? '') && onCommit(draft)}
        onSubmitEditing={() => !multiline && draft !== (value ?? '') && onCommit(draft)}
        multiline={multiline}
        placeholder={multiline ? 'What does this device do? Why is it here?' : 'Add…'}
        placeholderTextColor={theme.muted}
        style={[
          styles.input,
          multiline && styles.inputMulti,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.page },
        ]}
      />
    </View>
  );
}

function Row({ label, value, theme }: { label: string; value?: string | number; theme: Theme }) {
  if (value === undefined || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.muted }]}>{label}</Text>
      <Text selectable style={[styles.rowValue, { color: theme.text }]}>
        {value}
      </Text>
    </View>
  );
}

export function DeviceDetail({ device: d, parent, theme, onEdit, onForget, onSelect, onClose }: Props) {
  const [pickingKind, setPickingKind] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const meta = KINDS[d.kind];
  const color = theme.groups[meta.group];
  const connection =
    d.connection.medium === 'wifi'
      ? `Wi-Fi${d.connection.ssid ? ` · ${d.connection.ssid}` : ''}${d.connection.signal ? ` · ${d.connection.signal} dBm` : ''}`
      : d.connection.medium === 'wired'
        ? `Wired${d.connection.switchPort ? ` · port ${d.connection.switchPort}` : ''}`
        : undefined;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.header}>
        <View style={[styles.icon, { borderColor: color, backgroundColor: theme.page }]}>
          <MaterialCommunityIcons name={meta.icon as never} size={26} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
            {displayName(d)}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: d.online ? theme.good : theme.muted }]} />
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {d.online ? 'Online' : `Offline · last seen ${timeAgo(d.lastSeen)}`} · {meta.label}
            </Text>
          </View>
        </View>
        <Pressable onPress={onClose} accessibilityLabel="Close details" hitSlop={10}>
          <MaterialCommunityIcons name="close" size={20} color={theme.muted} />
        </Pressable>
      </View>

      {!d.acknowledged ? (
        <View style={[styles.newCard, { borderColor: theme.warning, backgroundColor: theme.page }]}>
          <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={theme.warning} />
          <Text style={[styles.newCardText, { color: theme.text }]}>
            New device, first seen {timeAgo(d.firstSeen)}. Do you recognise it?
          </Text>
          <Pressable onPress={() => onEdit({ acknowledged: true })} style={[styles.button, { backgroundColor: theme.accent }]}>
            <Text style={styles.buttonText}>It's mine</Text>
          </Pressable>
        </View>
      ) : null}

      <Field label="Name" value={d.name} theme={theme} onCommit={(name) => onEdit({ name })} />
      <Field label="Owner" value={d.owner} theme={theme} onCommit={(owner) => onEdit({ owner })} />
      <Field label="Notes" value={d.notes} theme={theme} onCommit={(notes) => onEdit({ notes })} multiline />

      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.muted }]}>Type {d.kindSetByUser ? '(set by you)' : '(guessed)'}</Text>
        <Pressable
          onPress={() => setPickingKind((v) => !v)}
          style={[styles.input, styles.kindButton, { borderColor: theme.border, backgroundColor: theme.page }]}
        >
          <Text style={{ color: theme.text, fontSize: 14 }}>{meta.label}</Text>
          <MaterialCommunityIcons name={pickingKind ? 'chevron-up' : 'chevron-down'} size={18} color={theme.muted} />
        </Pressable>
        {pickingKind ? (
          <View style={styles.kindGrid}>
            {KIND_ORDER.map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  onEdit({ kind: k });
                  setPickingKind(false);
                }}
                style={[styles.kindChip, { borderColor: k === d.kind ? theme.accent : theme.border }]}
              >
                <MaterialCommunityIcons name={KINDS[k].icon as never} size={14} color={theme.groups[KINDS[k].group]} />
                <Text style={[styles.kindChipText, { color: theme.text }]}>{KINDS[k].label}</Text>
              </Pressable>
            ))}
            {d.kindSetByUser ? (
              <Pressable onPress={() => onEdit({ kind: 'auto' })} style={[styles.kindChip, { borderColor: theme.border }]}>
                <MaterialCommunityIcons name="auto-fix" size={14} color={theme.muted} />
                <Text style={[styles.kindChipText, { color: theme.text }]}>Guess for me</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <Text style={[styles.section, { color: theme.textSecondary }]}>Connection</Text>
      {parent ? (
        <Pressable onPress={() => onSelect(parent.id)} style={styles.row}>
          <Text style={[styles.rowLabel, { color: theme.muted }]}>Connected to</Text>
          <Text style={[styles.rowValue, styles.link, { color: theme.accent }]}>{displayName(parent)}</Text>
        </Pressable>
      ) : null}
      <Row label="Link" value={connection} theme={theme} />
      <Row label="IP address" value={d.ip} theme={theme} />
      <Row
        label="MAC address"
        value={d.mac ? `${d.mac}${d.randomizedMac ? ' (private / randomized)' : ''}` : 'Hidden by macOS'}
        theme={theme}
      />
      <Row label="Hostname" value={d.hostname} theme={theme} />
      <Row
        label="Announces as"
        value={d.advertisedName !== d.name && d.advertisedName !== d.hostname ? d.advertisedName : undefined}
        theme={theme}
      />
      <Row label="Vendor" value={d.vendor} theme={theme} />
      <Row label="Model" value={d.model} theme={theme} />
      {d.traffic ? (
        <Row label="Traffic" value={`↓ ${formatBytes(d.traffic.rxBytes)} · ↑ ${formatBytes(d.traffic.txBytes)}`} theme={theme} />
      ) : null}

      <Text style={[styles.section, { color: theme.textSecondary }]}>What it's running</Text>
      {d.ports.length || d.mdnsServices.length ? (
        <View style={styles.services}>
          {d.ports.map((p) => {
            const scheme = WEB_PORTS[p.port];
            const content = (
              <>
                <Text style={[styles.serviceName, { color: theme.text }]}>
                  {p.service} <Text style={{ color: theme.muted }}>:{p.port}</Text>
                </Text>
                {p.title ? (
                  <Text style={[styles.serviceTitle, { color: theme.textSecondary }]} numberOfLines={1}>
                    “{p.title}”
                  </Text>
                ) : null}
              </>
            );
            return scheme && d.ip && !p.service.startsWith('AirPlay') ? (
              <Pressable
                key={p.port}
                onPress={() => Linking.openURL(`${scheme}://${d.ip}:${p.port}/`)}
                style={[styles.service, styles.serviceLink, { borderColor: theme.border }]}
              >
                {content}
                <MaterialCommunityIcons name="open-in-new" size={14} color={theme.accent} style={styles.serviceOpen} />
              </Pressable>
            ) : (
              <View key={p.port} style={[styles.service, { borderColor: theme.border }]}>
                {content}
              </View>
            );
          })}
          {d.mdnsServices.map((s) => (
            <View key={s} style={[styles.service, { borderColor: theme.border, borderStyle: 'dashed' }]}>
              <Text style={[styles.serviceName, { color: theme.text }]}>{s}</Text>
              <Text style={[styles.serviceTitle, { color: theme.muted }]}>Bonjour</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.emptyText, { color: theme.muted }]}>No open services found on common ports.</Text>
      )}

      <Text style={[styles.section, { color: theme.textSecondary }]}>History</Text>
      <Row label="First seen" value={new Date(d.firstSeen).toLocaleString()} theme={theme} />
      <Row label="Last seen" value={`${new Date(d.lastSeen).toLocaleString()} (${timeAgo(d.lastSeen)})`} theme={theme} />
      <Row label="Found by" value={d.sources.join(', ')} theme={theme} />

      <View style={styles.footer}>
        {confirmForget ? (
          <>
            <Text style={[styles.emptyText, { color: theme.textSecondary, flex: 1 }]}>
              Remove it and its notes? It reappears if it's seen again.
            </Text>
            <Pressable onPress={() => setConfirmForget(false)} style={[styles.button, { borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[styles.buttonText, { color: theme.text }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onForget} style={[styles.button, { backgroundColor: theme.critical }]}>
              <Text style={styles.buttonText}>Forget</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => setConfirmForget(true)} style={styles.forget}>
            <MaterialCommunityIcons name="trash-can-outline" size={16} color={theme.critical} />
            <Text style={{ color: theme.critical, fontSize: 13 }}>Forget device</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14 },
  icon: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  subtitle: { fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  newCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  newCardText: { flex: 1, fontSize: 13, minWidth: 160 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  inputMulti: { minHeight: 70, textAlignVertical: 'top' },
  kindButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  kindChipText: { fontSize: 12 },
  section: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', paddingVertical: 4, gap: 12 },
  rowLabel: { width: 110, fontSize: 13 },
  rowValue: { flex: 1, fontSize: 13 },
  link: { fontWeight: '600' },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  service: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  serviceName: { fontSize: 13, fontWeight: '600' },
  serviceTitle: { fontSize: 11, marginTop: 1 },
  serviceLink: { paddingRight: 26 },
  serviceOpen: { position: 'absolute', top: 6, right: 6 },
  emptyText: { fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 },
  forget: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
