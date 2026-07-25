import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * RealisticEnvironment — a purpose-built PROCEDURAL STUDIO whose reflection
 * is what most of this engine's metal actually looks like.
 *
 * Metal has almost no diffuse response: nearly everything you see on a
 * machined drum is a reflection of its surroundings. The previous environment
 * was three.js's RoomEnvironment — a small, uniformly lit white box — which
 * reflects as flat featureless grey and is why the compressor read as matte
 * plastic no matter how the lights were tuned. A photographer solves this
 * with SHAPED sources: a long softbox strip overhead (which draws the
 * elongated highlight that runs the length of anything cylindrical), a broad
 * key to one side, a cool rim opposite, and a dark floor so the bottom of the
 * part falls off into shadow.
 *
 * This builds exactly that as a tiny throwaway scene, bakes it through
 * PMREMGenerator, and hands the result to scene.environment. Still fully
 * offline: no HDR asset is ever fetched. Values above 1.0 are legal here
 * because PMREM renders into a half-float target, so the panels behave like
 * genuine HDR emitters and produce highlights bright enough for the bloom
 * threshold to catch.
 */

/** A softbox panel: size, position, look-at target, radiance, tint. */
interface Panel {
  size: [number, number];
  position: [number, number, number];
  /** Panels face the origin unless told otherwise. */
  radiance: number;
  color: string;
}

const PANELS: Panel[] = [
  // Long overhead strip running ALONG the engine axis — this is the one that
  // matters most: it becomes the streak highlight down every drum and case.
  { size: [26, 3.5], position: [0, 9, 0.5], radiance: 7.5, color: '#fff6ea' },
  // Broad key from the upper front-right, matching Lighting.tsx's key light.
  { size: [12, 9], position: [7, 5, 9], radiance: 4.2, color: '#fff3e2' },
  // Cool rim from behind-left, so silhouettes get a cold edge.
  { size: [10, 7], position: [-8, 3.5, -9], radiance: 2.6, color: '#9fc0e8' },
  // Low warm bounce, front-left: lifts the underside without flattening it.
  { size: [9, 4], position: [-6, -3, 7], radiance: 1.1, color: '#ffd8b0' },
];

function buildStudio(): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    place: (m: THREE.Mesh) => void,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    place(mesh);
    scene.add(mesh);
    disposables.push(geo, mat);
  };

  // Enclosing shell, lit from within: mid-grey walls, brighter ceiling, and a
  // deliberately DARK floor so parts keep a shadowed underside (the app
  // renders on a near-black background — a bright floor would betray it).
  const shell = new THREE.BoxGeometry(46, 26, 46);
  const shellMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.1, 0.11, 0.125),
    side: THREE.BackSide,
  });
  add(shell, shellMat, () => {});

  const ceiling = new THREE.PlaneGeometry(46, 46);
  const ceilingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.44, 0.48) });
  add(ceiling, ceilingMat, (m) => {
    m.position.set(0, 12.9, 0);
    m.rotation.x = Math.PI / 2;
  });

  const floor = new THREE.PlaneGeometry(46, 46);
  const floorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.032, 0.036) });
  add(floor, floorMat, (m) => {
    m.position.set(0, -12.9, 0);
    m.rotation.x = -Math.PI / 2;
  });

  for (const p of PANELS) {
    const geo = new THREE.PlaneGeometry(p.size[0], p.size[1]);
    const mat = new THREE.MeshBasicMaterial({
      // HDR radiance: legal because PMREM bakes into a half-float target.
      color: new THREE.Color(p.color).multiplyScalar(p.radiance),
      side: THREE.DoubleSide,
    });
    add(geo, mat, (m) => {
      m.position.set(...p.position);
      m.lookAt(0, 0, 0);
    });
  }

  return {
    scene,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function RealisticEnvironment() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const studio = buildStudio();
    // sigma 0 keeps the panel edges crisp; PMREM's own roughness mip chain
    // does the blurring, so rough parts still get soft reflections while
    // polished ones get tight, defined highlights.
    const target = pmrem.fromScene(studio.scene, 0);
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    scene.environment = target.texture;
    // Higher than the old 0.34: the studio's dark floor and shaped panels mean
    // more intensity buys reflection STRUCTURE rather than a uniform wash.
    scene.environmentIntensity = 0.62;

    return () => {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
      target.dispose();
      studio.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return null;
}
