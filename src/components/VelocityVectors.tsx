/**
 * VelocityVectors — optional axial flow arrows at each station.
 *
 * Each arrow's length scales with the local flow velocity and its color with
 * the local temperature, so you can see the flow accelerate through the
 * nozzles and slow down where the annulus is wide. Driven by the reactive
 * `showVelocityVectors` toggle.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { STATION_X, STATION_MARKER_RADIUS } from '../data/engineLayout';
import { temperatureColor } from '../util/colorScale';
import { clamp } from '../sim/units';
import type { StationId } from '../sim/types';

// Stations that carry meaningful axial flow (skip freestream marker).
const FLOW_IDS: StationId[] = ['2', '13', '25', '3', '4', '45', '5', '8', '18'];

export function VelocityVectors() {
  const show = useSimStore((s) => s.showVelocityVectors);
  const presentationMode = useSimStore((s) => s.presentationMode);
  const stations = useSimStore((s) => s.engine.stations);

  // One shared shaft + tip geometry, reused for every arrow.
  const shaftGeo = useMemo(() => new THREE.CylinderGeometry(0.025, 0.025, 1, 8), []);
  const tipGeo = useMemo(() => new THREE.ConeGeometry(0.07, 0.16, 10), []);

  // Presentation gates at the render site — showVelocityVectors is untouched.
  if (presentationMode || !show) return null;

  return (
    <group>
      {FLOW_IDS.map((id) => {
        const st = stations[id];
        const len = clamp(st.velocity / 150, 0.18, 3.2);
        const y = Math.max(0.3, STATION_MARKER_RADIUS[id] * 0.6);
        const color = temperatureColor(st.temperature).getStyle();
        return (
          <group key={id} position={[STATION_X[id], y, 0]}>
            {/* shaft: cylinder is along Y by default, rotate to +X */}
            <mesh geometry={shaftGeo} position={[len / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} scale={[1, len, 1]}>
              <meshBasicMaterial color={color} />
            </mesh>
            {/* arrowhead */}
            <mesh geometry={tipGeo} position={[len, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
