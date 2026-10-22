import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { displayName, timeAgo } from '../api';
import { SEVERITY, SEVERITY_ORDER, type Theme } from '../theme';
import type { Device, Finding, Snapshot } from '../types';

const CATEGORY_LABELS: Record<Finding['category'], string> = {
  internet: 'Internet exposure',
  service: 'Risky service',
  web: 'Unencrypted login',
};

export function FindingCard({
  finding: f,
  device,
  theme,
  onSelect,
  onAccept,
}: {
  finding: Finding;
  device?: Device;
  theme: Theme;
  onSelect?(id: string): void;
  onAccept(accepted: boolean): void;
}) {
  const severity = SEVERITY[f.severity];
  const color = severity.color(theme);
  return (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, borderLeftColor: f.accepted ? theme.border : color, backgroundColor: theme.page },
        f.accepted && { opacity: 0.7 },
      ]}
    >
      <View style={styles.cardMeta}>
        <MaterialCommunityIcons name={severity.icon as never} size={14} color={f.accepted ? theme.muted : color} />
        <Text style={[styles.metaText, { color: theme.textSecondary }]}>
          {f.accepted ? 'Expected' : severity.label} · {CATEGORY_LABELS[f.category]}
        </Text>
      </View>
      <Text style={[styles.cardTitle, { color: theme.text }]}>{f.title}</Text>
      {device && onSelect ? (
        <Pressable onPress={() => onSelect(device.id)} hitSlop={4}>
          <Text style={[styles.deviceLink, { color: theme.accent }]}>
            {displayName(device)}
            {device.ip ? <Text style={{ color: theme.muted }}> · {device.ip}{f.port ? `:${f.port}` : ''}</Text> : null}
          </Text>
        </Pressable>
      ) : null}
      {!f.accepted ? (
        <>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{f.detail}</Text>
          <Text style={[styles.body, { color: theme.text }]}>
            <Text style={{ fontWeight: '700' }}>How to fix: </Text>
            {f.fix}
          </Text>
        </>
      ) : null}
      {f.deviceId ? (
        <Pressable onPress={() => onAccept(!f.accepted)} style={[styles.acceptButton, { borderColor: theme.border }]}>
          <MaterialCommunityIcons name={f.accepted ? 'eye-outline' : 'check'} size={14} color={theme.textSecondary} />
          <Text style={[styles.acceptText, { color: theme.textSecondary }]}>{f.accepted ? 'Show as a problem again' : 'This is expected'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface Props {
  snapshot: Snapshot;
  theme: Theme;
  onSelect(id: string): void;
  onAccept(finding: Finding, accepted: boolean): void;
}

export function SecurityPanel({ snapshot, theme, onSelect, onAccept }: Props) {
  const [showAccepted, setShowAccepted] = useState(false);
  const { findings, upnp } = snapshot.security;
  const byId = new Map(snapshot.devices.map((d) => [d.id, d]));
  const open = findings.filter((f) => !f.accepted);
  const accepted = findings.filter((f) => f.accepted);
  const internetMappings = upnp?.mappings.filter((m) => m.enabled).length ?? 0;

  const upnpLine = !upnp
    ? { icon: 'help-circle-outline', color: theme.muted, text: 'Not checked yet. Run a scan.' }
    : !upnp.available
      ? {
          icon: 'shield-check',
          color: theme.good,
          text: upnp.error
            ? `Couldn’t check UPnP: ${upnp.error}`
            : 'UPnP is off or not offered by the router, so apps can’t open ports to the internet on their own.',
        }
      : internetMappings
        ? {
            icon: 'earth',
            color: theme.critical,
            text: `UPnP is on and ${internetMappings} port${internetMappings === 1 ? ' is' : 's are'} open to the internet${upnp.externalIp ? ` at ${upnp.externalIp}` : ''}.`,
          }
        : { icon: 'earth', color: theme.warning, text: 'UPnP is on, but no ports are open to the internet right now.' };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={[styles.subtitle, { color: theme.muted }]}>Checked {timeAgo(snapshot.lastScanAt)} · read-only, no passwords tried</Text>

      <View style={styles.tiles}>
        {SEVERITY_ORDER.map((s) => {
          const count = open.filter((f) => f.severity === s).length;
          return (
            <View key={s} style={[styles.tile, { borderColor: theme.border, backgroundColor: theme.page }]}>
              <View style={styles.tileHead}>
                <MaterialCommunityIcons name={SEVERITY[s].icon as never} size={13} color={count ? SEVERITY[s].color(theme) : theme.muted} />
                <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>{SEVERITY[s].label}</Text>
              </View>
              <Text style={[styles.tileCount, { color: count ? theme.text : theme.muted }]}>{count}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.section, { color: theme.textSecondary }]}>Internet exposure</Text>
      <View style={[styles.upnp, { borderColor: theme.border, backgroundColor: theme.page }]}>
        <MaterialCommunityIcons name={upnpLine.icon as never} size={18} color={upnpLine.color} />
        <Text style={[styles.body, { color: theme.text, flex: 1, marginTop: 0 }]}>{upnpLine.text}</Text>
      </View>

      <Text style={[styles.section, { color: theme.textSecondary }]}>Needs attention ({open.length})</Text>
      {open.length ? (
        open.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            device={f.deviceId ? byId.get(f.deviceId) : undefined}
            theme={theme}
            onSelect={onSelect}
            onAccept={(a) => onAccept(f, a)}
          />
        ))
      ) : (
        <View style={[styles.upnp, { borderColor: theme.border, backgroundColor: theme.page }]}>
          <MaterialCommunityIcons name="shield-check" size={18} color={theme.good} />
          <Text style={[styles.body, { color: theme.text, flex: 1, marginTop: 0 }]}>
            Nothing needs attention. The scan didn’t find risky services or unencrypted logins on devices that are online.
          </Text>
        </View>
      )}

      {accepted.length ? (
        <>
          <Pressable onPress={() => setShowAccepted((v) => !v)} style={styles.acceptedToggle}>
            <MaterialCommunityIcons name={showAccepted ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textSecondary} />
            <Text style={[styles.section, { color: theme.textSecondary, marginTop: 0, marginBottom: 0 }]}>
              Marked as expected ({accepted.length})
            </Text>
          </Pressable>
          {showAccepted
            ? accepted.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  device={f.deviceId ? byId.get(f.deviceId) : undefined}
                  theme={theme}
                  onSelect={onSelect}
                  onAccept={(a) => onAccept(f, a)}
                />
              ))
            : null}
        </>
      ) : null}

      <Text style={[styles.section, { color: theme.textSecondary }]}>What this checks</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        Which ports your router has opened to the internet through UPnP, services that are risky to leave reachable (Telnet, Docker,
        databases, Android debugging and more), and login pages that send passwords without encryption. It only looks: it never tries
        passwords, sends exploits or changes settings. Offline devices are checked again when they come back.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  subtitle: { fontSize: 12, marginBottom: 12 },
  tiles: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, minWidth: 0 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tileLabel: { fontSize: 11, fontWeight: '600' },
  tileCount: { fontSize: 20, fontWeight: '700', marginTop: 2 },
  section: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 6 },
  upnp: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderRadius: 8, padding: 10 },
  card: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 8, padding: 10, marginBottom: 8, gap: 2 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 11, fontWeight: '600' },
  cardTitle: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  deviceLink: { fontSize: 13, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  acceptText: { fontSize: 12, fontWeight: '600' },
  acceptedToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 16, marginBottom: 6 },
});
