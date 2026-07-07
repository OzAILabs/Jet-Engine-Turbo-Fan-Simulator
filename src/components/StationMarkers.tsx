/**
 * StationMarkers — floating, clickable markers for each aerodynamic station.
 *
 * Aerodynamic "stations" (numbered 0, 2, 13, 25, ...) are the agreed-upon
 * reference planes engineers use to talk about the gas as it travels through
 * the engine. Here each one gets:
 *   - a small sphere floating above the axis, colored by the local gas
 *     temperature (cool blue -> white-hot), always clickable;
 *   - a thin leader line dropping from the sphere down to the engine axis so
 *     you can see exactly where on the engine the station sits;
 *   - an optional always-on label (the station number + short name); and
 *   - a detailed info card when the station is selected.
 *
 * This component owns no animation of its own; it just reads the latest
 * steady-state numbers from the store and renders DOM (via drei <Html>) for
 * the labels and card. Temperature -> color is computed in render, which is
 * fine because it only re-runs when the engine solution actually changes.
 */
import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { STATION_X, STATION_MARKER_RADIUS, explodeShiftX } from '../data/engineLayout';
import { STATION_COPY } from '../data/educationalCopy';
import { paToKpa, kelvinToCelsius } from '../sim/units';
import { temperatureColor } from '../util/colorScale';
import { useSimStore } from '../store/useSimStore';
import type { StationId, StationState } from '../sim/types';

/** Stable, ordered list of the ten stations (front of engine -> exhaust). */
const STATION_IDS: StationId[] = ['0', '2', '13', '25', '3', '4', '45', '5', '8', '18'];

export function StationMarkers() {
  // Reactive subscriptions: only re-render when these slices actually change.
  const stations = useSimStore((s) => s.engine.stations);
  const showStationLabels = useSimStore((s) => s.showStationLabels);
  const selectedStation = useSimStore((s) => s.selectedStation);
  const exploded = useSimStore((s) => s.viewMode === 'exploded');
  const presentationMode = useSimStore((s) => s.presentationMode);

  // Actions are stable references on the store; grab them once.
  const selectStation = useSimStore((s) => s.selectStation);
  const focusOn = useSimStore((s) => s.focusOn);

  // Presentation mode hides the entire marker layer (spheres, leader lines,
  // Html labels and cards) — they are diagram scaffolding, not hardware.
  // We gate HERE instead of flipping showStationLabels, so the user's
  // overlay checkbox survives a round trip through presentation mode.
  if (presentationMode) return null;

  return (
    <group>
      {STATION_IDS.map((id) => (
        <StationMarker
          key={id}
          id={id}
          station={stations[id]}
          showLabel={showStationLabels}
          selected={selectedStation === id}
          exploded={exploded}
          onSelect={selectStation}
          onFocus={focusOn}
        />
      ))}
    </group>
  );
}

interface StationMarkerProps {
  id: StationId;
  station: StationState;
  showLabel: boolean;
  selected: boolean;
  exploded: boolean;
  onSelect: (id: StationId | null) => void;
  onFocus: (point: [number, number, number]) => void;
}

function StationMarker({ id, station, showLabel, selected, exploded, onSelect, onFocus }: StationMarkerProps) {
  // Where the marker floats: at the station's axial position, lifted up by a
  // radius hint (but never crammed against the axis). In exploded view the
  // axial position shifts with its module so the marker still points at it.
  const x = exploded ? explodeShiftX(STATION_X[id]) : STATION_X[id];
  const markerY = Math.max(0.4, STATION_MARKER_RADIUS[id]);

  // Heat color for the sphere, recomputed only when this station's temp changes.
  const color = useMemo(() => temperatureColor(station.temperature).getStyle(), [station.temperature]);

  return (
    <group position={[x, markerY, 0]}>
      {/* Leader line from the marker straight down to the engine axis. */}
      <Line
        points={[
          [0, 0, 0],
          [0, -markerY, 0],
        ]}
        color="#8aa0b8"
        lineWidth={1}
        transparent
        opacity={0.6}
      />

      {/* The marker sphere — always clickable regardless of view mode. */}
      <mesh
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFocus([x, markerY, 0]);
        }}
      >
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          // Selected markers glow brightly so the picked station stands out.
          emissiveIntensity={selected ? 1.4 : 0.35}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      {/* Always-on compact label: station number + short name. */}
      {showLabel && (
        <Html center occlude={false} position={[0, 0.18, 0]}>
          <div className="marker-label">
            {id} {station.name}
          </div>
        </Html>
      )}

      {/* Detailed info card for the selected station. */}
      {selected && (
        <Html center occlude={false} position={[0, 0.35, 0]}>
          <div className="station-card" onPointerDown={(e) => e.stopPropagation()}>
            <div className="sc-title">
              {id} - {station.name}
            </div>

            <div className="sc-grid">
              <div className="sc-row">
                <span className="sc-k">Pressure</span>
                <span className="sc-v">{paToKpa(station.pressure).toFixed(0)} kPa</span>
              </div>
              <div className="sc-row">
                <span className="sc-k">Temperature</span>
                <span className="sc-v">
                  {station.temperature.toFixed(0)} K ({kelvinToCelsius(station.temperature).toFixed(0)} degC)
                </span>
              </div>
              <div className="sc-row">
                <span className="sc-k">Velocity</span>
                <span className="sc-v">{station.velocity.toFixed(0)} m/s</span>
              </div>
              <div className="sc-row">
                <span className="sc-k">Mass flow</span>
                <span className="sc-v">{station.massFlow.toFixed(0)} kg/s</span>
              </div>
              <div className="sc-row">
                <span className="sc-k">Enthalpy h</span>
                <span className="sc-v">{(station.enthalpy / 1000).toFixed(0)} kJ/kg</span>
              </div>
              <div className="sc-row">
                <span className="sc-k">Entropy s</span>
                <span className="sc-v">{station.entropy.toFixed(0)} J/(kg·K)</span>
              </div>
            </div>

            <p className="sc-explain">{STATION_COPY[id].explanation}</p>
            <p className="sc-changed">What changed: {STATION_COPY[id].whatChanged}</p>

            <button
              className="sc-close"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(null);
              }}
            >
              Close
            </button>
          </div>
        </Html>
      )}
    </group>
  );
}
