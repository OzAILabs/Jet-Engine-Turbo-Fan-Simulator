/**
 * ExhaustPlume — chooses the exhaust rendering style from the store.
 *
 *   - 'volumetric' (default, "Realistic"): a very subtle, barely-visible warm
 *     jet — a hint of hot gas streaming aft (ExhaustVolumetric).
 *   - 'shader' ("Dramatic"): a brighter incandescent flame with shock diamonds
 *     (ExhaustShader).
 */
import { useSimStore } from '../store/useSimStore';
import { ExhaustShader } from './ExhaustShader';
import { ExhaustVolumetric } from './ExhaustVolumetric';

export function ExhaustPlume() {
  const style = useSimStore((s) => s.exhaustStyle);
  return style === 'shader' ? <ExhaustShader /> : <ExhaustVolumetric />;
}
