import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { displayName } from '../api';
import {
  ancestorsOf,
  buildTree,
  collapsibleIds,
  flatten,
  radialLayout,
  treeLayout,
  type GroupBy,
  type LayoutMode,
  type Point,
  type TreeNode,
} from '../graph';
import { GROUP_LABELS, GROUP_ORDER, KINDS, type Group, type Theme } from '../theme';
import type { Snapshot } from '../types';

const NODE = 38;
const ROOT_NODE = 50;
const LABEL_WIDTH = 160;
const TWEEN_MS = 380;

const GROUP_ICONS: Record<Group, string> = {
  infrastructure: 'lan',
  computers: 'desktop-classic',
  personal: 'cellphone',
  media: 'television-play',
  smartHome: 'home-automation',
  unknown: 'help-circle-outline',
};

type Viewport = { x: number; y: number; k: number };

function usePreference<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (globalThis.localStorage?.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (v: T) => {
      setValue(v);
      try {
        globalThis.localStorage?.setItem(key, v);
      } catch {
        // Storage unavailable; the choice lasts for this session.
      }
    },
    [key],
  );
  return [value, update];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Glides nodes from where they are to where the layout wants them; new nodes grow out of their parent. */
function useTweenedPositions(target: Map<string, Point>, parentOf: Map<string, string | undefined>) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = new Map<string, Point>();
    for (const [id, to] of target) {
      let origin = shownRef.current.get(id);
      let ancestor = parentOf.get(id);
      while (!origin && ancestor) {
        origin = shownRef.current.get(ancestor);
        ancestor = parentOf.get(ancestor);
      }
      from.set(id, origin ?? to);
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = ease(Math.min(1, (now - start) / TWEEN_MS));
      const next = new Map<string, Point>();
      for (const [id, to] of target) {
        const f = from.get(id)!;
        next.set(id, { x: f.x + (to.x - f.x) * t, y: f.y + (to.y - f.y) * t });
      }
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return shown;
}

function PulseRing({ color, size }: { color: string; size: number }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration: 1800, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [value]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: color,
        opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
      }}
    />
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: { value: T; label: string; icon: string }[];
  value: T;
  onChange(v: T): void;
  theme: Theme;
}) {
  return (
    <View style={[styles.segmented, { borderColor: theme.border, backgroundColor: theme.raised }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: theme.accent }]}
          >
            <MaterialCommunityIcons name={o.icon as never} size={14} color={active ? '#fff' : theme.textSecondary} />
            <Text style={[styles.segmentText, { color: active ? '#fff' : theme.textSecondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface Props {
  snapshot: Snapshot;
  theme: Theme;
  selectedId?: string;
  matchingIds?: Set<string>;
  onSelect(id: string | undefined): void;
}

export function NetworkGraph({ snapshot, theme, selectedId, matchingIds, onSelect }: Props) {
  const [mode, setMode] = usePreference<LayoutMode>('netmap.layout', 'tree');
  const [groupBy, setGroupBy] = usePreference<GroupBy>('netmap.groupBy', 'type');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [hoverId, setHoverId] = useState<string>();
  const [legendOpen, setLegendOpen] = useState(false);
  const container = useRef<ComponentRef<typeof View>>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const root = useMemo(() => buildTree(snapshot, groupBy, collapsed), [snapshot, groupBy, collapsed]);
  const visible = useMemo(() => (root ? flatten(root) : []), [root]);
  const nodesById = useMemo(() => new Map(visible.map((n) => [n.id, n])), [visible]);
  const parentOf = useMemo(() => new Map(visible.map((n) => [n.id, n.parentId])), [visible]);

  // Expanding or collapsing reflows the whole layout; this offset pins the clicked node in place.
  const anchor = useRef<{ id: string; at: Point } | undefined>(undefined);
  const offset = useRef<Point>({ x: 0, y: 0 });
  const target = useMemo(() => {
    if (!root) return new Map<string, Point>();
    const raw = mode === 'tree' ? treeLayout(root) : radialLayout(root);
    const pinned = anchor.current && raw.get(anchor.current.id);
    if (anchor.current && pinned) {
      offset.current = { x: anchor.current.at.x - pinned.x, y: anchor.current.at.y - pinned.y };
    }
    anchor.current = undefined;
    const shifted = new Map<string, Point>();
    for (const [id, p] of raw) shifted.set(id, { x: p.x + offset.current.x, y: p.y + offset.current.y });
    return shifted;
  }, [root, mode]);
  const positions = useTweenedPositions(target, parentOf);

  const animateView = useCallback((to: Viewport) => {
    const from = viewRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = ease(Math.min(1, (now - start) / TWEEN_MS));
      setView({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, k: from.k + (to.k - from.k) * t });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const fitTo = useCallback(
    (points: Map<string, Point>, animate = true, minScale = 0) => {
      if (!size.width || !points.size) return;
      const xs = [...points.values()].map((p) => p.x);
      const ys = [...points.values()].map((p) => p.y);
      const left = Math.min(...xs) - 60;
      const right = Math.max(...xs) + (mode === 'tree' ? LABEL_WIDTH + 30 : 80);
      const top = Math.min(...ys) - (mode === 'tree' ? 70 : 60);
      const bottom = Math.max(...ys) + (mode === 'tree' ? 40 : 90);
      const k = Math.max(minScale, Math.min(size.width / (right - left), size.height / (bottom - top), 1.3));
      const to = { k, x: size.width / 2 - ((left + right) / 2) * k, y: size.height / 2 - ((top + bottom) / 2) * k };
      if (animate) animateView(to);
      else setView(to);
    },
    [size, mode, animateView],
  );

  // Refit when the map changes wholesale: first load, layout or grouping switch, a big resize.
  const fittedFor = useRef('');
  const refitNext = useRef(false);
  useEffect(() => {
    const key = `${mode}|${groupBy}|${Math.round(size.width / 50)}x${Math.round(size.height / 50)}`;
    if (!size.width || !target.size || (fittedFor.current === key && !refitNext.current)) return;
    const first = !fittedFor.current;
    fittedFor.current = key;
    refitNext.current = false;
    // The tree stops shrinking at a readable size and scrolls instead; radial is an overview, so it fits whole.
    fitTo(target, !first, mode === 'tree' ? (size.width < 600 ? 0.6 : 0.8) : 0);
  }, [mode, groupBy, size, target, fitTo]);

  const toggle = (id: string) => {
    const at = positions.get(id);
    if (at) anchor.current = { id, at };
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAll = (collapse: boolean) => {
    if (!root) return;
    refitNext.current = true;
    setCollapsed(collapse ? new Set(collapsibleIds(root).filter((id) => id.startsWith('bucket:'))) : new Set());
  };

  const switchMode = (m: LayoutMode) => {
    offset.current = { x: 0, y: 0 };
    setMode(m);
  };

  const switchGrouping = (g: GroupBy) => {
    offset.current = { x: 0, y: 0 };
    setCollapsed(new Set());
    setGroupBy(g);
  };

  // Selecting a device opens any collapsed branch above it, then brings it into view once it's laid out.
  const reveal = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedId || !root) return;
    reveal.current = selectedId;
    const closed = ancestorsOf(root, selectedId).filter((id) => collapsed.has(id));
    if (closed.length) setCollapsed((c) => new Set([...c].filter((id) => !closed.includes(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const id = reveal.current;
    const p = id ? target.get(id) : undefined;
    if (!p || !size.width) return;
    reveal.current = undefined;
    const v = viewRef.current;
    const sx = p.x * v.k + v.x;
    const sy = p.y * v.k + v.y;
    const margin = 60;
    if (sx < margin || sy < margin || sx > size.width - LABEL_WIDTH || sy > size.height - margin) {
      animateView({ ...v, x: size.width / 2 - p.x * v.k, y: size.height / 2 - p.y * v.k });
    }
  }, [selectedId, target, size.width, animateView]);

  const zoomAt = (factor: number, cx = size.width / 2, cy = size.height / 2) => {
    setView((v) => {
      const k = Math.min(3, Math.max(0.2, v.k * factor));
      const scale = k / v.k;
      return { k, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale };
    });
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = container.current as unknown as HTMLElement | null;
    if (!el) return;
    // Trackpad scroll pans; pinch (ctrl+wheel), ⌘+scroll or a plain mouse wheel zooms.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaX) < 1 && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(undefined);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const panStart = useRef(view);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          panStart.current = viewRef.current;
        },
        onPanResponderMove: (_, g) => setView({ ...panStart.current, x: panStart.current.x + g.dx, y: panStart.current.y + g.dy }),
      }),
    [],
  );

  // Hovering lights the route to the router plus everything hanging below; selection keeps its route lit.
  const focusId = hoverId ?? selectedId;
  const lit = useMemo(() => {
    const route = new Set<string>();
    const below = new Set<string>();
    if (!focusId || !nodesById.has(focusId)) return { route, below };
    let id: string | undefined = focusId;
    while (id) {
      route.add(id);
      id = parentOf.get(id);
    }
    const walk = (n: TreeNode) => {
      if (n.collapsed) return;
      for (const c of n.children) {
        below.add(c.id);
        walk(c);
      }
    };
    walk(nodesById.get(focusId)!);
    return { route, below };
  }, [focusId, nodesById, parentOf]);

  const bounds = useMemo(() => {
    const pts = [...positions.values()];
    if (!pts.length) return { minX: 0, minY: 0, width: 1, height: 1 };
    const minX = Math.min(...pts.map((p) => p.x)) - 10;
    const minY = Math.min(...pts.map((p) => p.y)) - 10;
    return { minX, minY, width: Math.max(...pts.map((p) => p.x)) - minX + 20, height: Math.max(...pts.map((p) => p.y)) - minY + 20 };
  }, [positions]);

  const matchingBranches = useMemo(() => {
    if (!matchingIds || !root) return undefined;
    const ids = new Set<string>();
    for (const n of flatten(root, true)) {
      if (n.device && matchingIds.has(n.device.id)) for (const id of [n.id, ...ancestorsOf(root, n.id)]) ids.add(id);
    }
    return ids;
  }, [matchingIds, root]);

  if (!root) {
    return (
      <View style={[styles.container, styles.empty, { backgroundColor: theme.surface }]}>
        <Text style={{ color: theme.muted }}>Waiting for the router to show up in a scan…</Text>
      </View>
    );
  }

  const matchesFilter = (n: TreeNode) => !matchingBranches || matchingBranches.has(n.id);
  const hovering = hoverId !== undefined;

  const edgePath = (a: Point, b: Point) => {
    const ax = a.x - bounds.minX;
    const ay = a.y - bounds.minY;
    const bx = b.x - bounds.minX;
    const by = b.y - bounds.minY;
    if (mode === 'tree') {
      const mid = (ax + bx) / 2;
      return `M${ax},${ay} C${mid},${ay} ${mid},${by} ${bx},${by}`;
    }
    // Radial: bend each link along the rings, like d3's linkRadial.
    const c = positions.get(root.id) ?? { x: 0, y: 0 };
    const polar = (q: Point) => ({ r: Math.hypot(q.x - c.x, q.y - c.y), t: Math.atan2(q.y - c.y, q.x - c.x) });
    const pa = polar(a);
    const pb = polar(b);
    const rm = (pa.r + pb.r) / 2;
    const ta = pa.r < 1 ? pb.t : pa.t;
    const at = (r: number, t: number) => `${c.x + Math.cos(t) * r - bounds.minX},${c.y + Math.sin(t) * r - bounds.minY}`;
    return `M${ax},${ay} C${at(rm, ta)} ${at(rm, pb.t)} ${bx},${by}`;
  };

  const hovered = hoverId ? nodesById.get(hoverId)?.device : undefined;
  const hoverPos = hoverId ? positions.get(hoverId) : undefined;
  const narrow = size.width < 600;

  return (
    <View
      ref={container}
      style={[styles.container, { backgroundColor: theme.surface }]}
      onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      {...pan.panHandlers}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={() => onSelect(undefined)} accessibilityLabel="Clear selection" />
      <View
        style={[styles.world, { transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.k }] }]}
        pointerEvents="box-none"
      >
        <Svg
          width={bounds.width}
          height={bounds.height}
          style={{ position: 'absolute', left: bounds.minX, top: bounds.minY }}
          pointerEvents="none"
        >
          {visible
            .filter((n) => n.parentId)
            .map((n) => {
              const a = positions.get(n.parentId!);
              const b = positions.get(n.id);
              if (!a || !b) return null;
              const onRoute = lit.route.has(n.id) && lit.route.has(n.parentId!);
              const inBranch = lit.below.has(n.id);
              const offline = n.device ? !n.device.online : n.online === 0;
              const faded = (hovering && !onRoute && !inBranch) || !matchesFilter(n) || offline;
              return (
                <Path
                  key={n.id}
                  d={edgePath(a, b)}
                  fill="none"
                  stroke={onRoute || inBranch ? theme.edgeActive : theme.edge}
                  strokeWidth={onRoute ? 3 : inBranch ? 2 : 1.5}
                  strokeDasharray={n.medium === 'wifi' ? '5 5' : undefined}
                  strokeOpacity={faded && !onRoute ? 0.35 : 1}
                />
              );
            })}
        </Svg>

        {visible.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const isRoot = n.depth === 0;
          const nodeSize = isRoot ? ROOT_NODE : n.bucket ? NODE - 2 : NODE;
          const d = n.device;
          const group = d ? KINDS[d.kind].group : n.bucket?.group;
          const color = group ? theme.groups[group] : theme.textSecondary;
          const icon = d
            ? KINDS[d.kind].icon
            : n.bucket?.isOwner
              ? n.bucket.label === 'No owner'
                ? 'account-question-outline'
                : 'account'
              : GROUP_ICONS[group!];
          const selected = d !== undefined && d.id === selectedId;
          const dimmed = !matchesFilter(n) || (hovering && !lit.route.has(n.id) && !lit.below.has(n.id));
          const label = d ? (d.isSelf ? 'This Mac' : displayName(d)) : n.bucket!.label;
          const sub = d
            ? isRoot
              ? `${n.online} of ${n.total} online`
              : [d.ip, d.ports[0]?.service].filter(Boolean).join(' · ')
            : `${n.total} device${n.total === 1 ? '' : 's'} · ${n.online} online`;
          const canCollapse = !isRoot && n.children.length > 0;
          const labelRight = mode === 'tree';
          const press = () => (d ? onSelect(selected ? undefined : d.id) : toggle(n.id));
          const hoverProps = {
            onHoverIn: () => setHoverId(n.id),
            onHoverOut: () => setHoverId((h) => (h === n.id ? undefined : h)),
          };

          return (
            <View
              key={n.id}
              style={[
                styles.node,
                labelRight
                  ? { left: p.x - nodeSize / 2, top: p.y - nodeSize / 2, flexDirection: 'row', alignItems: 'center' }
                  : { left: p.x - LABEL_WIDTH / 2, top: p.y - nodeSize / 2, width: LABEL_WIDTH, alignItems: 'center' },
                { opacity: dimmed ? 0.25 : d && !d.online ? 0.55 : 1 },
              ]}
              pointerEvents="box-none"
            >
              <Pressable
                onPress={press}
                {...hoverProps}
                accessibilityRole="button"
                accessibilityLabel={
                  d
                    ? `${label}, ${KINDS[d.kind].label}, ${d.online ? 'online' : 'offline'}`
                    : `${label}, ${n.total} devices, ${n.collapsed ? 'collapsed' : 'expanded'}`
                }
                style={{ width: nodeSize, height: nodeSize, alignItems: 'center', justifyContent: 'center' }}
              >
                {d && !d.acknowledged && d.online ? <PulseRing color={theme.warning} size={nodeSize} /> : null}
                <View
                  style={{
                    width: nodeSize,
                    height: nodeSize,
                    borderRadius: n.bucket ? 10 : nodeSize / 2,
                    backgroundColor: n.bucket ? theme.page : theme.raised,
                    borderColor: selected ? theme.text : color,
                    borderWidth: selected ? 3 : 2,
                    borderStyle: n.bucket && n.collapsed ? 'dashed' : 'solid',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name={icon as never} size={isRoot ? 28 : 19} color={color} />
                </View>
                {d ? (
                  <View style={[styles.statusDot, { backgroundColor: d.online ? theme.good : theme.muted, borderColor: theme.surface }]} />
                ) : null}
                {n.bucket ? (
                  <View style={[styles.countBadge, { backgroundColor: color }]}>
                    <Text style={styles.countText}>{n.total}</Text>
                  </View>
                ) : null}
              </Pressable>

              <Pressable
                onPress={press}
                {...hoverProps}
                style={[
                  styles.labelBox,
                  { backgroundColor: theme.surface },
                  labelRight ? { marginLeft: 8, maxWidth: LABEL_WIDTH } : { marginTop: 3, maxWidth: LABEL_WIDTH, alignItems: 'center' },
                ]}
              >
                <View style={styles.labelRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.label, { color: theme.text, fontWeight: selected || n.bucket || isRoot ? '700' : '500' }]}
                  >
                    {label}
                  </Text>
                  {d && !d.acknowledged ? (
                    <View style={[styles.newBadge, { backgroundColor: theme.warning }]}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>
                  ) : null}
                </View>
                {labelRight || n.bucket || isRoot ? (
                  <Text numberOfLines={1} style={[styles.sublabel, { color: theme.muted }]}>
                    {sub}
                  </Text>
                ) : null}
              </Pressable>

              {canCollapse && labelRight ? (
                <Pressable
                  onPress={() => toggle(n.id)}
                  accessibilityLabel={n.collapsed ? `Expand ${label}` : `Collapse ${label}`}
                  hitSlop={8}
                  style={[styles.chevron, { borderColor: theme.border, backgroundColor: theme.raised }]}
                >
                  <MaterialCommunityIcons name={n.collapsed ? 'chevron-right' : 'chevron-left'} size={14} color={theme.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      {hovered && hoverPos ? (
        <View
          pointerEvents="none"
          style={[
            styles.tooltip,
            {
              backgroundColor: theme.raised,
              borderColor: theme.border,
              left: Math.min(
                size.width - 220,
                Math.max(8, (hoverPos.x + (mode === 'tree' ? NODE / 2 + LABEL_WIDTH + 30 : 30)) * view.k + view.x),
              ),
              top: Math.min(size.height - 110, Math.max(8, hoverPos.y * view.k + view.y - (mode === 'tree' ? 20 : -26))),
            },
          ]}
        >
          <Text style={[styles.tooltipTitle, { color: theme.text }]}>{displayName(hovered)}</Text>
          <Text style={[styles.tooltipLine, { color: theme.textSecondary }]}>
            {KINDS[hovered.kind].label} · {hovered.online ? 'online' : 'offline'}
          </Text>
          {hovered.ip ? <Text style={[styles.tooltipLine, { color: theme.textSecondary }]}>{hovered.ip}</Text> : null}
          {hovered.ports.length || hovered.mdnsServices.length ? (
            <Text style={[styles.tooltipLine, { color: theme.textSecondary }]} numberOfLines={2}>
              {[...hovered.ports.map((p) => p.service), ...hovered.mdnsServices].join(', ')}
            </Text>
          ) : null}
          {hovered.notes ? (
            <Text style={[styles.tooltipLine, { color: theme.text, marginTop: 4 }]} numberOfLines={3}>
              {hovered.notes}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.toolbar, { maxWidth: size.width - 70 }]}>
        <Segmented
          theme={theme}
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'tree', label: 'Tree', icon: 'file-tree-outline' },
            { value: 'radial', label: 'Radial', icon: 'chart-donut' },
          ]}
        />
        <Segmented
          theme={theme}
          value={groupBy}
          onChange={switchGrouping}
          options={[
            { value: 'type', label: narrow ? 'Type' : 'By type', icon: 'shape-outline' },
            { value: 'owner', label: narrow ? 'Owner' : 'By owner', icon: 'account-outline' },
            { value: 'none', label: 'Flat', icon: 'dots-horizontal' },
          ]}
        />
        {groupBy !== 'none' ? (
          <View style={[styles.segmented, { borderColor: theme.border, backgroundColor: theme.raised }]}>
            <Pressable onPress={() => setAll(false)} style={styles.segment} accessibilityLabel="Expand all groups">
              <MaterialCommunityIcons name="unfold-more-vertical" size={14} color={theme.textSecondary} />
              {!narrow ? <Text style={[styles.segmentText, { color: theme.textSecondary }]}>Expand</Text> : null}
            </Pressable>
            <Pressable onPress={() => setAll(true)} style={styles.segment} accessibilityLabel="Collapse all groups">
              <MaterialCommunityIcons name="unfold-less-vertical" size={14} color={theme.textSecondary} />
              {!narrow ? <Text style={[styles.segmentText, { color: theme.textSecondary }]}>Collapse</Text> : null}
            </Pressable>
          </View>
        ) : null}
      </View>

      {!narrow || legendOpen ? (
        <Pressable
          onPress={() => setLegendOpen(false)}
          disabled={!narrow}
          style={[styles.legend, { backgroundColor: theme.raised, borderColor: theme.border }]}
        >
          {GROUP_ORDER.filter((g) => snapshot.devices.some((d) => KINDS[d.kind].group === g)).map((g) => (
            <View key={g} style={styles.legendRow}>
              <View style={[styles.legendSwatch, { borderColor: theme.groups[g] }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>{GROUP_LABELS[g]}</Text>
            </View>
          ))}
          <View style={[styles.legendRow, { marginTop: 4 }]}>
            <View style={[styles.legendLine, { backgroundColor: theme.textSecondary }]} />
            <Text style={[styles.legendText, { color: theme.textSecondary }]}>Wired</Text>
            <View style={[styles.legendLine, styles.legendDashed, { borderColor: theme.textSecondary, marginLeft: 10 }]} />
            <Text style={[styles.legendText, { color: theme.textSecondary }]}>Wi-Fi</Text>
          </View>
          <Text style={[styles.legendHint, { color: theme.muted }]}>
            Click a group to fold it. Scroll to pan, pinch or ⌘-scroll to zoom.
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setLegendOpen(true)}
          accessibilityLabel="Show legend"
          style={[styles.legend, styles.legendRow, { backgroundColor: theme.raised, borderColor: theme.border }]}
        >
          <MaterialCommunityIcons name="information-outline" size={14} color={theme.textSecondary} />
          <Text style={[styles.legendText, { color: theme.textSecondary }]}>Legend</Text>
        </Pressable>
      )}

      <View style={styles.controls}>
        {[
          { icon: 'plus', label: 'Zoom in', onPress: () => zoomAt(1.25) },
          { icon: 'minus', label: 'Zoom out', onPress: () => zoomAt(0.8) },
          { icon: 'fit-to-screen-outline', label: 'Fit to screen', onPress: () => fitTo(target) },
        ].map((c) => (
          <Pressable
            key={c.icon}
            onPress={c.onPress}
            accessibilityLabel={c.label}
            style={[styles.control, { backgroundColor: theme.raised, borderColor: theme.border }]}
          >
            <MaterialCommunityIcons name={c.icon as never} size={18} color={theme.text} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', cursor: 'grab' } as never,
  empty: { alignItems: 'center', justifyContent: 'center' },
  world: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible' },
  node: { position: 'absolute' },
  statusDot: { position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  labelBox: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { fontSize: 12, flexShrink: 1 },
  sublabel: { fontSize: 11 },
  newBadge: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  newBadgeText: { fontSize: 8, fontWeight: '800', color: '#0b0b0b', letterSpacing: 0.5 },
  chevron: { marginLeft: 4, width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tooltip: { position: 'absolute', width: 210, padding: 10, borderRadius: 8, borderWidth: 1, gap: 2 },
  tooltipTitle: { fontSize: 13, fontWeight: '700' },
  tooltipLine: { fontSize: 12 },
  toolbar: { position: 'absolute', left: 12, top: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 2, gap: 2 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 },
  segmentText: { fontSize: 12, fontWeight: '600' },
  legend: { position: 'absolute', left: 12, bottom: 12, padding: 10, borderRadius: 8, borderWidth: 1, gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5 },
  legendText: { fontSize: 11 },
  legendHint: { fontSize: 10, marginTop: 4, maxWidth: 190 },
  legendLine: { width: 18, height: 2 },
  legendDashed: { height: 0, borderTopWidth: 2, borderStyle: 'dashed', backgroundColor: 'transparent' },
  controls: { position: 'absolute', right: 12, top: 12, gap: 6 },
  control: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
