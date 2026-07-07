/**
 * The engine's ASSEMBLY HIERARCHY — the modular stack a real GE90 is built
 * (and maintained) as, for the assembly-tree explorer panel. Click a node →
 * the camera flies to it and its story card appears.
 *
 * Geometry references come straight from engineLayout (single source of
 * truth); descriptions are written for students: what it is, why it exists.
 */
import { AXIS, EXTERNALS, clockToYZ } from './engineLayout';

export interface AssemblyNode {
  id: string;
  label: string;
  /** 1–3 sentence student-facing story: what it is + why it exists. */
  description: string;
  /** Camera focus point [x, y, z]. */
  focus: [number, number, number];
  children?: AssemblyNode[];
}

const mid = (a: number, b: number): number => (a + b) / 2;
const agbY = clockToYZ(EXTERNALS.agb.clock, 1.05).y;

export const ASSEMBLY_TREE: AssemblyNode = {
  id: 'engine',
  label: 'GE90-115B Turbofan',
  description:
    'A two-spool high-bypass turbofan: a slow, huge fan driven by a 6-stage LP turbine, wrapped around a fast gas-generator core. It is built as a stack of independent MODULES so any one can be swapped without tearing down the rest.',
  focus: [mid(AXIS.inletLip, AXIS.plugEnd), 0, 0],
  children: [
    {
      id: 'fan-module',
      label: 'Fan Module',
      description:
        'The propulsor. 22 wide-chord composite blades move ~90% of the air AROUND the core — most of the thrust comes from here, not the jet.',
      focus: [AXIS.fanPlane, 0, 0],
      children: [
        {
          id: 'spinner',
          label: 'Spinner',
          description:
            'The ogive nose cone smooths flow into the blade roots and sheds ice; the painted spiral makes rotation obvious to ground crews near a running engine.',
          focus: [AXIS.fanPlane - 0.6, 0, 0],
        },
        {
          id: 'fan-disk',
          label: 'Fan Disk & Dovetails',
          description:
            'The single most stressed part of the engine: each blade pulls on its dovetail slot with roughly the weight of a loaded semi truck at takeoff RPM.',
          focus: [AXIS.fanPlane, 0.6, 0],
        },
        {
          id: 'fan-ogv',
          label: 'Outlet Guide Vanes',
          description:
            'Stationary vanes that straighten the fan’s swirling discharge — recovering the swirl as useful pressure before the bypass nozzle.',
          focus: [AXIS.fanPlane + 0.82, 1.6, 0],
        },
      ],
    },
    {
      id: 'compressor-module',
      label: 'Compressor Module',
      description:
        'Squeezes the core air to ~40× ambient pressure across 13 stages on two independent shafts, so each can spin at the speed its blades want.',
      focus: [mid(AXIS.lpcStart, AXIS.hpcEnd), 0, 0],
      children: [
        {
          id: 'booster',
          label: 'Booster (LPC)',
          description:
            '4 stages on the FAN shaft. Pre-compresses core air so the HPC doesn’t have to do all the work; its excess air dumps overboard through the VBV doors at low speed.',
          focus: [mid(AXIS.lpcStart, AXIS.lpcEnd), 0.55, 0],
        },
        {
          id: 'hpc',
          label: 'HP Compressor',
          description:
            '9 stages on the fast core shaft, with variable stator vanes on the front stages that re-aim the flow as speed changes — the FADEC schedules them hydraulically.',
          focus: [mid(AXIS.hpcStart, AXIS.hpcEnd), 0.5, 0],
        },
        {
          id: 'vsv-vbv',
          label: 'VSV Rings & VBV Doors',
          description:
            'The compressor’s variable geometry: unison rings twist the stator vanes, bleed doors dump booster air. Both exist for one reason — keeping the compressor out of surge.',
          focus: [EXTERNALS.vbv.x, -0.75, 0],
        },
        {
          id: 'spacers-seals',
          label: 'Spacers & Labyrinth Seals',
          description:
            'Between stages, knife-edge seal teeth ride the drum against the stator shrouds — leakage past a stage is compression the engine paid for and lost.',
          focus: [mid(AXIS.hpcStart, AXIS.hpcEnd), 0.42, 0],
        },
      ],
    },
    {
      id: 'combustor-module',
      label: 'Combustor Module',
      description:
        'An annular fire can where fuel meets 40-atmosphere air. Swirlers behind each of the 16 fuel nozzles anchor the flame; dilution air trims the gas so the turbine survives it.',
      focus: [mid(AXIS.combustorStart, AXIS.combustorEnd), 0.45, 0],
      children: [
        {
          id: 'fuel-nozzles',
          label: 'Fuel Nozzles & Swirlers',
          description:
            'Dual-orifice atomizers inside pitched-vane swirlers: the vortex they spin holds the flame in place — without it the fire would blow straight out the back.',
          focus: [AXIS.combustorStart + 0.12, 0.5, 0],
        },
        {
          id: 'igniters',
          label: 'Igniters',
          description:
            'Two spark plugs (A and B) used only for starting and heavy rain/turbulence — once lit, the flame is self-sustaining.',
          focus: [EXTERNALS.igniterPlugs[0].x, -0.7, 0.3],
        },
      ],
    },
    {
      id: 'turbine-module',
      label: 'Turbine Module',
      description:
        'Where the energy comes back out: 2 HPT stages drive the compressor, 6 LPT stages drive the fan. The HPT works in gas hotter than its blades’ melting point — cooling air keeps the metal alive.',
      focus: [mid(AXIS.hptStart, AXIS.lptEnd), 0, 0],
      children: [
        {
          id: 'hpt',
          label: 'HP Turbine',
          description:
            'Two stages extracting ~60 MW from the hottest gas in the machine. Film-cooling air (~8% of core flow, tapped before the burner) sweats out through hundreds of holes in each blade.',
          focus: [mid(AXIS.hptStart, AXIS.hptEnd), 0.5, 0],
        },
        {
          id: 'lpt',
          label: 'LP Turbine',
          description:
            'Six big stages pulling the fan’s enormous power demand from lower-pressure gas — which is why it needs three times the stages of the HPT.',
          focus: [mid(AXIS.lptStart, AXIS.lptEnd), 0.7, 0],
        },
      ],
    },
    {
      id: 'exhaust-module',
      label: 'Exhaust Module',
      description:
        'The core nozzle and tail plug convert what pressure and heat remain into jet velocity — the final push after the turbines have taken their share.',
      focus: [mid(AXIS.coreNozzleStart, AXIS.plugEnd), 0, 0],
    },
    {
      id: 'accessories-module',
      label: 'Accessory Drive & Systems',
      description:
        'The engine’s life support: a tower shaft steals power off the core spool, runs down the 6:00 strut, and spins the gearbox that drives the fuel pump, oil pumps, generators and hydraulics.',
      focus: [(EXTERNALS.agb.xStart + EXTERNALS.agb.xEnd) / 2, agbY, 0],
      children: [
        {
          id: 'agb',
          label: 'Accessory Gearbox',
          description:
            'Six meshing spur gears fan the tower-shaft power out to the accessory pads. The air-turbine starter on its aft face is how the whole engine wakes up.',
          focus: [(EXTERNALS.agb.xStart + EXTERNALS.agb.xEnd) / 2, agbY, 0.3],
        },
        {
          id: 'oil-system',
          label: 'Oil System',
          description:
            'Tank on the fan case, pressure and scavenge pumps on the gearbox, jets at every bearing. Oil is a CIRCUIT — enable the Secondary Flows overlay to watch it loop.',
          focus: [EXTERNALS.oilTank.x, clockToYZ(EXTERNALS.oilTank.clock, EXTERNALS.oilTank.r).y, clockToYZ(EXTERNALS.oilTank.clock, EXTERNALS.oilTank.r).z],
        },
        {
          id: 'fadec',
          label: 'FADEC (EEC)',
          description:
            'The dual-channel computer that owns the engine: fuel metering, variable geometry, start sequencing, limit protection. The throttle is a REQUEST — the FADEC decides.',
          focus: [EXTERNALS.ecu.x, clockToYZ(EXTERNALS.ecu.clock, EXTERNALS.ecu.r).y, clockToYZ(EXTERNALS.ecu.clock, EXTERNALS.ecu.r).z],
        },
        {
          id: 'bearings-shafts',
          label: 'Shafts & Bearings',
          description:
            'Two concentric shafts spin inside each other, carried by bearings in three frames. Switch to the Internals view to watch the races and rollers live.',
          focus: [0.0, 0, 0],
        },
      ],
    },
  ],
};

/** Flat lookup by id (memoized at module load — the tree is static). */
export const ASSEMBLY_INDEX: ReadonlyMap<string, AssemblyNode> = (() => {
  const map = new Map<string, AssemblyNode>();
  const walk = (n: AssemblyNode) => {
    map.set(n.id, n);
    n.children?.forEach(walk);
  };
  walk(ASSEMBLY_TREE);
  return map;
})();
