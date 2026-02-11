/**
 * Ref system: maps AX nodes to backendNodeId + boundingBox
 * Replaces testing-library query semantics with portable handles
 */

import type { Ref, BoundingBox } from './types';
import { ACTIONABLE_ROLES } from './types';
import type { CDPSession } from './cdp';

interface AXNode {
  nodeId: string;
  parentId?: string;
  backendDOMNodeId?: number;
  role?: { value: string };
  name?: { value: string };
  value?: { value: string };
  ignored?: boolean;
  childIds?: string[];
}

interface DOMSnapshotResult {
  documents: Array<{
    nodes: {
      backendNodeId: number[];
    };
    layout: {
      nodeIndex: number[];
      bounds: number[][];
    };
  }>;
}

/** Generate short sequential ref ID */
function generateRefId(index: number): string {
  return `e${index}`;
}

/** Extract bounding box from layout data */
function extractBoundingBox(
  backendNodeId: number,
  snapshot: DOMSnapshotResult
): BoundingBox | null {
  for (const doc of snapshot.documents) {
    const nodeIndex = doc.nodes.backendNodeId.indexOf(backendNodeId);
    if (nodeIndex === -1) continue;

    const layoutIdx = doc.layout.nodeIndex.indexOf(nodeIndex);
    if (layoutIdx === -1) continue;

    const bounds = doc.layout.bounds[layoutIdx];
    if (bounds && bounds.length >= 4) {
      return {
        x: bounds[0],
        y: bounds[1],
        width: bounds[2],
        height: bounds[3],
      };
    }
  }
  return null;
}

/** Check if bounding box is visible (non-zero dimensions) */
function isVisible(box: BoundingBox | null): boolean {
  if (!box) return false;
  return box.width > 0 && box.height > 0;
}

interface TreeNode {
  node: AXNode;
  ref?: Ref;
  children: TreeNode[];
}

function buildTree(nodes: AXNode[], refsByAxId: Map<string, Ref>): TreeNode | null {
  if (nodes.length === 0) return null;

  const nodeMap = new Map<string, AXNode>();
  const childrenByParent = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) {
      siblings.push(node.nodeId);
    } else {
      childrenByParent.set(node.parentId, [node.nodeId]);
    }
  }

  function getChildIds(nodeId: string): string[] {
    return childrenByParent.get(nodeId) ?? nodeMap.get(nodeId)?.childIds ?? [];
  }

  function collectDescendants(nodeId: string, visiting: Set<string>): TreeNode[] {
    const results: TreeNode[] = [];
    for (const childId of getChildIds(nodeId)) {
      const child = nodeMap.get(childId);
      if (!child) continue;
      if (child.ignored) {
        if (!visiting.has(childId)) {
          visiting.add(childId);
          results.push(...collectDescendants(childId, visiting));
          visiting.delete(childId);
        }
      } else {
        const childTree = toTreeNode(child, visiting);
        if (childTree) results.push(childTree);
      }
    }
    return results;
  }

  function toTreeNode(axNode: AXNode, visiting: Set<string>): TreeNode | null {
    if (axNode.ignored) return null;
    if (visiting.has(axNode.nodeId)) return null;
    visiting.add(axNode.nodeId);

    const children = collectDescendants(axNode.nodeId, visiting);

    visiting.delete(axNode.nodeId);

    const ref = refsByAxId.get(axNode.nodeId);

    if (ref || children.length > 0) return { node: axNode, ref, children };

    if (axNode.name?.value) return { node: axNode, ref, children };

    return null;
  }

  const root =
    nodes.find(n => n.role?.value?.toLowerCase() === 'rootwebarea') ??
    nodes.find(n => !n.parentId) ??
    nodes[0];

  return toTreeNode(root, new Set());
}

const SKIP_ROLES = new Set(['none', 'generic', 'genericcontainer']);

function renderTree(treeNode: TreeNode, depth: number = 0): string {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  const role = treeNode.node.role?.value || 'unknown';
  const name = treeNode.node.name?.value || '';
  const refTag = treeNode.ref ? ` [ref=${treeNode.ref.id}]` : '';

  const skip = SKIP_ROLES.has(role.toLowerCase()) && !treeNode.ref;
  if (!skip) {
    const nameStr = name ? ` "${name}"` : '';
    lines.push(`${indent}${role}${nameStr}${refTag}`);
  }

  const childDepth = skip ? depth : depth + 1;
  for (const child of treeNode.children) {
    lines.push(renderTree(child, childDepth));
  }

  return lines.filter(Boolean).join('\n');
}

export function formatAriaTree(nodes: AXNode[], refs: Ref[]): string {
  const refsByAxId = new Map<string, Ref>();
  for (const ref of refs) {
    if (ref.axNodeId) refsByAxId.set(ref.axNodeId, ref);
  }

  const root = buildTree(nodes, refsByAxId);
  if (!root) return 'Empty page';
  return renderTree(root);
}

/**
 * Build refs from AX tree + DOM snapshot
 * Pipeline:
 * 1. Get full AX tree
 * 2. Get DOM snapshot with layout
 * 3. Join on backendNodeId
 * 4. Filter to actionable, visible elements
 */
export interface BuildRefsResult {
  refs: Ref[];
  tree: string;
}

export async function buildRefs(session: CDPSession): Promise<BuildRefsResult> {
  const axResult = await session.send<{ nodes: AXNode[] }>(
    'Accessibility.getFullAXTree'
  );

  const domSnapshot = await session.send<DOMSnapshotResult>(
    'DOMSnapshot.captureSnapshot',
    {
      computedStyles: [],
      includeDOMRects: true,
      includePaintOrder: false,
    }
  );

  const refs: Ref[] = [];
  let index = 0;

  for (const node of axResult.nodes) {
    if (node.ignored) continue;

    const role = node.role?.value?.toLowerCase() || '';
    if (!ACTIONABLE_ROLES.has(role)) continue;

    if (!node.backendDOMNodeId) continue;

    const boundingBox = extractBoundingBox(node.backendDOMNodeId, domSnapshot);

    if (!isVisible(boundingBox)) continue;

    const ref: Ref = {
      id: generateRefId(index),
      backendNodeId: node.backendDOMNodeId,
      axNodeId: node.nodeId,
      role: node.role?.value || 'unknown',
      name: node.name?.value || '',
      value: node.value?.value,
      boundingBox,
    };

    refs.push(ref);
    index++;
  }

  const tree = formatAriaTree(axResult.nodes, refs);
  return { refs, tree };
}

/** Store refs by ID for quick lookup */
export class RefStore {
  private refs = new Map<string, Ref>();

  update(refs: Ref[]): void {
    this.refs.clear();
    for (const ref of refs) {
      this.refs.set(ref.id, ref);
    }
  }

  get(id: string): Ref | undefined {
    return this.refs.get(id);
  }

  getAll(): Ref[] {
    return Array.from(this.refs.values());
  }

  clear(): void {
    this.refs.clear();
  }
}
