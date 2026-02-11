/**
 * Ref system: maps AX nodes to backendNodeId + boundingBox
 * Replaces testing-library query semantics with portable handles
 */

import type { Ref, BoundingBox } from './types';
import { ACTIONABLE_ROLES } from './types';
import type { CDPSession } from './cdp';

interface AXNode {
  nodeId: string;
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

/** Generate unique ref ID */
function generateRefId(node: AXNode, index: number): string {
  const role = node.role?.value || 'unknown';
  const name = node.name?.value?.slice(0, 20) || '';
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
  return `${role}_${safeName}_${index}`.toLowerCase();
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

/**
 * Build refs from AX tree + DOM snapshot
 * Pipeline:
 * 1. Get full AX tree
 * 2. Get DOM snapshot with layout
 * 3. Join on backendNodeId
 * 4. Filter to actionable, visible elements
 */
export async function buildRefs(session: CDPSession): Promise<Ref[]> {
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
      id: generateRefId(node, index),
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

  return refs;
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
