/**
 * Named camera presets for the museum-style exhibit. Positions are in scene
 * units (= meters). `zoom` applies to the orthographic camera; the perspective
 * camera ignores it and uses position/target only.
 */
import type { CameraPreset } from '../store/useSimStore';
import { AXIS, ENGINE_CENTER } from '../data/engineLayout';

export interface CameraPresetDef {
  key: CameraPreset;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export const CAMERA_PRESETS: Record<CameraPreset, CameraPresetDef> = {
  iso: {
    key: 'iso',
    label: 'Full Engine Isometric',
    position: [8, 5.5, 9],
    target: ENGINE_CENTER,
    zoom: 34,
  },
  fan: {
    key: 'fan',
    label: 'Front Fan View',
    position: [-6.5, 2.2, 6.5],
    target: [AXIS.fanPlane, 0, 0],
    zoom: 52,
  },
  compressor: {
    key: 'compressor',
    label: 'Compressor Cutaway',
    position: [-1.2, 3, 7],
    target: [-1.0, 0, 0],
    zoom: 60,
  },
  combustor: {
    key: 'combustor',
    label: 'Combustor / Turbine View',
    position: [1.3, 2.6, 6],
    target: [1.1, 0, 0],
    zoom: 70,
  },
  exhaust: {
    key: 'exhaust',
    label: 'Exhaust View',
    position: [7.5, 2.8, 6],
    target: [2.9, 0, 0],
    zoom: 54,
  },
  top: {
    key: 'top',
    label: 'Top Cutaway View',
    position: [0.2, 12, 0.4],
    target: ENGINE_CENTER,
    zoom: 38,
  },

  // --- Cinematic poses (presentation mode / beauty shots) ------------------
  // Composed for the PERSPECTIVE camera: low eye lines, strong diagonals,
  // camera below the engine axis (the floor sits at y = -2.4, so every eye
  // height here stays above it). They still resolve under ortho — the `zoom`
  // is the graceful fallback — and being ordinary presets they are reachable
  // from the window.__sim capture bridge by key like any other view.
  hero: {
    key: 'hero',
    label: 'Hero (3/4 Low Front)',
    position: [-8.6, -0.9, 7.2],
    target: [0.3, 0.1, 0],
    zoom: 40,
  },
  intake: {
    key: 'intake',
    label: 'Intake Close-up',
    // Just off-axis, low, looking slightly up into the spinning fan.
    position: [AXIS.fanPlane - 3.4, -1.1, 2.0],
    target: [AXIS.fanPlane + 0.6, 0.15, 0],
    zoom: 66,
  },
  'exhaust-low': {
    key: 'exhaust-low',
    label: 'Exhaust (Rear Low)',
    position: [9.0, -1.3, 4.2],
    target: [2.7, 0.15, 0],
    zoom: 50,
  },
};

export const CAMERA_PRESET_LIST: CameraPresetDef[] = [
  CAMERA_PRESETS.iso,
  CAMERA_PRESETS.fan,
  CAMERA_PRESETS.compressor,
  CAMERA_PRESETS.combustor,
  CAMERA_PRESETS.exhaust,
  CAMERA_PRESETS.top,
];

/** Cinematic beauty poses — shown as their own group in the Camera panel. */
export const CINEMATIC_PRESET_LIST: CameraPresetDef[] = [
  CAMERA_PRESETS.hero,
  CAMERA_PRESETS.intake,
  CAMERA_PRESETS['exhaust-low'],
];
