/**
 * SectionLabels — floating DOM labels for each major engine section.
 *
 * For every entry in SECTIONS we render a drei <Html> badge above the engine,
 * tinted with the section's accent color. Clicking a badge selects that section
 * (which opens its detail elsewhere in the UI) and flies the camera to it.
 *
 * Visibility is driven by the reactive `showSectionLabels` toggle; the currently
 * selected section gets a brighter, emphasized style.
 */
import { Html } from '@react-three/drei';
import { SECTIONS, explodeShiftX } from '../data/engineLayout';
import { SECTION_LABELS } from '../data/educationalCopy';
import { useSimStore } from '../store/useSimStore';

export function SectionLabels() {
  // Reactive subscriptions: re-render when the toggle or selection changes.
  const showSectionLabels = useSimStore((s) => s.showSectionLabels);
  const selectedSection = useSimStore((s) => s.selectedSection);
  const selectSection = useSimStore((s) => s.selectSection);
  const focusOn = useSimStore((s) => s.focusOn);
  const exploded = useSimStore((s) => s.viewMode === 'exploded');

  if (!showSectionLabels) return null;

  return (
    <>
      {SECTIONS.map((section) => {
        // Axial midpoint of the section; float the badge above its outer radius.
        // In exploded view, shift with the module so the label still points at it.
        const rawCenter = (section.xStart + section.xEnd) / 2;
        const xCenter = exploded ? explodeShiftX(rawCenter) : rawCenter;
        const isSelected = selectedSection === section.id;

        return (
          <Html
            key={section.id}
            center
            occlude={false}
            position={[xCenter, section.rOuter + 0.8, 0]}
          >
            <div
              className="section-label"
              style={{
                borderColor: section.color,
                color: section.color,
                // Emphasize the selected section with a tinted glow.
                background: isSelected ? `${section.color}22` : undefined,
                boxShadow: isSelected ? `0 0 12px ${section.color}` : undefined,
                opacity: isSelected ? 1 : 0.85,
              }}
              onPointerDown={(e) => {
                // Keep the click from reaching the canvas / OrbitControls.
                e.stopPropagation();
                selectSection(section.id);
                focusOn([xCenter, 0, 0]);
              }}
            >
              <div className="sl-name">{section.label}</div>
              <div className="sl-desc">{SECTION_LABELS[section.id]}</div>
            </div>
          </Html>
        );
      })}
    </>
  );
}
