/**
 * CameraRig — owns both cameras, the OrbitControls, and all scripted camera
 * moves (presets, focus-on-click, reset).
 *
 * - An OrthographicCamera is the default ("isometric technical" look); a
 *   PerspectiveCamera is available via the camera-mode toggle.
 * - OrbitControls gives mouse orbit (left drag), pan (right/middle drag) and
 *   zoom (wheel), with damping and floor-flip protection.
 * - When the store's cameraCommand changes, we smoothly interpolate the camera
 *   position, the controls target, and (for ortho) the zoom toward the new goal.
 */
import { type ElementRef, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { CAMERA_PRESETS } from '../util/cameraPresets';

const tmpDir = new THREE.Vector3();

export function CameraRig() {
  const orthoRef = useRef<THREE.OrthographicCamera>(null!);
  const perspRef = useRef<THREE.PerspectiveCamera>(null!);
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null!);

  const cameraMode = useSimStore((s) => s.cameraMode);
  const cameraCommand = useSimStore((s) => s.cameraCommand);
  const debugMode = useSimStore((s) => s.debugMode);
  const invalidate = useThree((s) => s.invalidate);

  // Animation goals.
  const goalPos = useRef(new THREE.Vector3(...CAMERA_PRESETS.iso.position));
  const goalTarget = useRef(new THREE.Vector3(...CAMERA_PRESETS.iso.target));
  const goalZoom = useRef(CAMERA_PRESETS.iso.zoom);
  const animating = useRef(false);

  const activeCamera = () => (cameraMode === 'orthographic' ? orthoRef.current : perspRef.current);

  // Recompute goals whenever a camera command is issued or the mode changes.
  useEffect(() => {
    const { kind, preset, focusPoint } = cameraCommand;
    const def = CAMERA_PRESETS[preset];

    if (kind === 'focus' && focusPoint) {
      // Keep the current viewing direction; reframe on the focused point.
      const cam = activeCamera();
      tmpDir.copy(cam.position).sub(controlsRef.current.target);
      if (tmpDir.lengthSq() < 1e-6) tmpDir.set(6, 4, 7);
      tmpDir.normalize().multiplyScalar(5.5);
      goalTarget.current.set(...focusPoint);
      goalPos.current.copy(goalTarget.current).add(tmpDir);
      goalZoom.current = Math.max(90, goalZoom.current);
    } else {
      goalPos.current.set(...def.position);
      goalTarget.current.set(...def.target);
      goalZoom.current = def.zoom;
    }
    animating.current = true;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraCommand.nonce, cameraMode]);

  // Snap to the isometric preset on first mount.
  useEffect(() => {
    const cam = activeCamera();
    cam.position.set(...CAMERA_PRESETS.iso.position);
    controlsRef.current.target.set(...CAMERA_PRESETS.iso.target);
    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = CAMERA_PRESETS.iso.zoom;
      cam.updateProjectionMatrix();
    }
    controlsRef.current.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (animating.current) {
      const cam = activeCamera();
      const t = 0.12;
      cam.position.lerp(goalPos.current, t);
      controls.target.lerp(goalTarget.current, t);
      if (cam instanceof THREE.OrthographicCamera) {
        cam.zoom += (goalZoom.current - cam.zoom) * t;
        cam.updateProjectionMatrix();
      }
      const close =
        cam.position.distanceToSquared(goalPos.current) < 1e-4 &&
        controls.target.distanceToSquared(goalTarget.current) < 1e-4;
      if (close) animating.current = false;
      invalidate();
    }
    controls.update();
  });

  const polarLimit = debugMode ? Math.PI : Math.PI * 0.52;
  const minPolar = debugMode ? 0 : Math.PI * 0.06;

  return (
    <>
      <OrthographicCamera
        ref={orthoRef}
        makeDefault={cameraMode === 'orthographic'}
        position={CAMERA_PRESETS.iso.position}
        zoom={CAMERA_PRESETS.iso.zoom}
        near={-100}
        far={200}
      />
      <PerspectiveCamera
        ref={perspRef}
        makeDefault={cameraMode === 'perspective'}
        position={CAMERA_PRESETS.iso.position}
        fov={42}
        near={0.1}
        far={500}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan
        enableZoom
        minZoom={18}
        maxZoom={420}
        minDistance={3}
        maxDistance={70}
        minPolarAngle={minPolar}
        maxPolarAngle={polarLimit}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}
