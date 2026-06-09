/**
 * CutawayEdges
 *
 * Draws a crisp GE-marketing-style BLUE outline along the CUT boundaries of a
 * cutaway shell — reproducing the look of the official GE90 marketing cutaway
 * where every cut edge is rimmed in bright blue.
 *
 * It takes the SAME cutaway BufferGeometry the parent shell already builds and
 * derives an EdgesGeometry from it. Because the cutaway shells are partial-sweep
 * lathes/cones (a wedge removed, ends left open), the wedge-opening faces and
 * the front/back rims are OPEN boundary edges -> EdgesGeometry always emits
 * those. A generous thresholdAngle then suppresses the near-coplanar seams along
 * the smooth curved skin, so we get the cut outline + silhouette rims WITHOUT a
 * busy wireframe over the whole surface.
 *
 * The view-mode gate lives at the call site (mounted only in 'cutaway' mode), so
 * this stays a pure, reusable primitive.
 */
import { useMemo, useEffect } from 'react';
import * as THREE from 'three';

/** GE-style bright cutaway blue. */
const GE_CUT_BLUE = '#39a0ff';

/**
 * Above this dihedral angle an edge is drawn. The curved lathe skin bends only a
 * few degrees between adjacent segments, so ~30 deg hides those interior seams
 * while every sharp rim / cut face (and all open boundary edges) is kept.
 */
const EDGE_THRESHOLD_DEG = 30;

export interface CutawayEdgesProps {
  /** The cutaway shell geometry to outline (reuse the shell's own geometry). */
  geometry: THREE.BufferGeometry;
  /** Override color if needed; defaults to GE cutaway blue. */
  color?: THREE.ColorRepresentation;
  /** Optional offsets to match a parent mesh (e.g. the core nozzle). */
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export function CutawayEdges({ geometry, color = GE_CUT_BLUE, position, rotation }: CutawayEdgesProps) {
  // Derive the edge lines from the shell geometry. Rebuilds only if the source
  // geometry instance changes (effectively constant).
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEG), [geometry]);

  // EdgesGeometry allocates GPU buffers; dispose when swapped out / unmounted
  // (e.g. leaving cutaway mode).
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <lineSegments geometry={edges} position={position} rotation={rotation} renderOrder={1}>
      <lineBasicMaterial color={color} toneMapped={false} depthWrite={false} />
    </lineSegments>
  );
}
