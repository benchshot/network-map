import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import { displayName } from './api';
import { GROUP_LABELS, GROUP_ORDER, KINDS, type Group } from './theme';
import type { Device, Link, Snapshot } from './types';

export type LayoutMode = 'tree' | 'radial';
export type GroupBy = 'type' | 'owner' | 'none';

export interface TreeNode {
  id: string;
  parentId?: string;
  depth: number;
  device?: Device;
  /** Set on the synthetic nodes that bucket devices by type or owner. */
  bucket?: { label: string; group?: Group; isOwner: boolean };
  children: TreeNode[];
  collapsed: boolean;
  /** Devices under this node, counted through collapsed branches too. */
  total: number;
  online: number;
  medium: Link['medium'];
}

export interface Point {
  x: number;
  y: number;
}

const INFRA = new Set(['gateway', 'switch', 'ap']);

function sortDevices(a: Device, b: Device) {
  return Number(b.online) - Number(a.online) || displayName(a).localeCompare(displayName(b));
}

function bucketKey(d: Device, groupBy: GroupBy): { key: string; label: string; group?: Group; isOwner: boolean } {
  if (groupBy === 'owner') {
    const owner = d.owner?.trim();
    return { key: owner ? `owner:${owner.toLowerCase()}` : 'owner:', label: owner || 'No owner', isOwner: true };
  }
  const group = KINDS[d.kind].group;
  return { key: group, label: GROUP_LABELS[group], group, isOwner: false };
}

/**
 * Router at the root, real network gear (switches, APs reported by a router) as branches,
 * and every other device bucketed under its parent by type or owner.
 */
export function buildTree(snapshot: Snapshot, groupBy: GroupBy, collapsed: Set<string>): TreeNode | undefined {
  const byId = new Map(snapshot.devices.map((d) => [d.id, d]));
  const children = new Map<string, Device[]>();
  const medium = new Map<string, Link['medium']>();
  for (const l of snapshot.links) {
    const child = byId.get(l.target);
    if (!child) continue;
    children.set(l.source, [...(children.get(l.source) ?? []), child]);
    medium.set(l.target, l.medium);
  }
  const root = snapshot.gatewayId ? byId.get(snapshot.gatewayId) : undefined;
  if (!root) return undefined;

  const build = (device: Device, depth: number, parentId?: string): TreeNode => {
    const node: TreeNode = {
      id: device.id,
      parentId,
      depth,
      device,
      children: [],
      collapsed: collapsed.has(device.id),
      total: 0,
      online: 0,
      medium: medium.get(device.id) ?? 'unknown',
    };
    const kids = (children.get(device.id) ?? []).sort(sortDevices);
    const branches = kids.filter((k) => INFRA.has(k.kind) && children.has(k.id));
    const leaves = kids.filter((k) => !branches.includes(k));

    for (const b of branches) node.children.push(build(b, depth + 1, node.id));

    if (groupBy === 'none') {
      for (const leaf of leaves) node.children.push(build(leaf, depth + 1, node.id));
    } else {
      const buckets = new Map<string, { meta: ReturnType<typeof bucketKey>; devices: Device[] }>();
      for (const leaf of leaves) {
        const meta = bucketKey(leaf, groupBy);
        const entry = buckets.get(meta.key) ?? { meta, devices: [] };
        entry.devices.push(leaf);
        buckets.set(meta.key, entry);
      }
      const ordered = [...buckets.entries()].sort(([a, ea], [b, eb]) =>
        groupBy === 'type'
          ? GROUP_ORDER.indexOf(a as Group) - GROUP_ORDER.indexOf(b as Group)
          : Number(a === 'owner:') - Number(b === 'owner:') || ea.meta.label.localeCompare(eb.meta.label),
      );
      for (const [key, { meta, devices }] of ordered) {
        const id = `bucket:${device.id}:${key}`;
        const bucket: TreeNode = {
          id,
          parentId: node.id,
          depth: depth + 1,
          bucket: { label: meta.label, group: meta.group, isOwner: meta.isOwner },
          children: devices.map((d) => build(d, depth + 2, id)),
          collapsed: collapsed.has(id),
          total: 0,
          online: 0,
          medium: 'wired',
        };
        node.children.push(bucket);
      }
    }

    return node;
  };

  const count = (node: TreeNode) => {
    node.total = 0;
    node.online = 0;
    for (const c of node.children) {
      count(c);
      node.total += c.total + (c.device ? 1 : 0);
      node.online += c.online + (c.device?.online ? 1 : 0);
    }
  };

  const tree = build(root, 0);
  count(tree);
  return tree;
}

export function flatten(root: TreeNode, includeCollapsed = false): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    out.push(n);
    if (!n.collapsed || includeCollapsed) n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export const TREE_ROW = 44;
export const TREE_COLUMN = 250;

function visibleHierarchy(root: TreeNode) {
  return hierarchy(root, (n) => (n.collapsed ? [] : n.children));
}

/** Left-to-right tidy tree: depth runs along x, siblings stack down y. */
export function treeLayout(root: TreeNode): Map<string, Point> {
  const laidOut = tree<TreeNode>()
    .nodeSize([TREE_ROW, TREE_COLUMN])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.5))(visibleHierarchy(root));
  const positions = new Map<string, Point>();
  laidOut.each((n: HierarchyPointNode<TreeNode>) => positions.set(n.data.id, { x: n.y, y: n.x }));
  return positions;
}

/** The same tree wrapped around the router: each level is a ring, leaves spread around the outside. */
export function radialLayout(root: TreeNode): Map<string, Point> {
  const h = visibleHierarchy(root);
  const leaves = h.leaves().length;
  const height = Math.max(h.height, 1);
  const outer = Math.max(height * 170, (leaves * 112) / (2 * Math.PI));
  const laidOut = tree<TreeNode>()
    .size([2 * Math.PI, outer])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(a.depth, 1))(h);
  const positions = new Map<string, Point>();
  laidOut.each((n) => {
    const angle = n.x - Math.PI / 2;
    positions.set(n.data.id, { x: Math.cos(angle) * n.y, y: Math.sin(angle) * n.y });
  });
  return positions;
}

/** Ids of every collapsible node: anything with children except the root. */
export function collapsibleIds(root: TreeNode): string[] {
  return flatten(root, true)
    .filter((n) => n.depth > 0 && n.children.length > 0)
    .map((n) => n.id);
}

export function ancestorsOf(root: TreeNode, id: string): string[] {
  const parents = new Map(flatten(root, true).map((n) => [n.id, n.parentId]));
  const out: string[] = [];
  let current = parents.get(id);
  while (current) {
    out.push(current);
    current = parents.get(current);
  }
  return out;
}
