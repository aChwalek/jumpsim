// Equipment configuration and the physical parameters derived from it.
// Everything the flight model needs is computed here so that changing canopy
// size or pilot weight is only a matter of changing a RigConfig.

import { DEG, vec3, type Vec3 } from './vec';

export const FT2_TO_M2 = 0.09290304;
export const KG_TO_LB = 2.20462262;
export const GRAVITY = 9.80665;
export const AIR_DENSITY_SEA_LEVEL = 1.225;

export interface RigConfig {
  /** Canopy flat area, square feet (the unit skydivers use). */
  canopyAreaFt2: number;
  /** Pilot plus all gear, kg. */
  exitWeightKg: number;
  /** Span squared over area. ~2.5 student, ~2.7 sport, ~3 high performance. */
  aspectRatio: number;
  /**
   * How close the inflated wing comes to a rigid one of the same planform,
   * for lift slope and induced drag. Cells that bulge and ribs that sag
   * between line attachments cost some; cross-bracing holds the shape better.
   */
  spanEfficiency: number;
  /**
   * Chambers in each cell, between two ribs that carry lines: 2 for a plain
   * canopy, 3 for a cross-braced one ("tri-cell").
   */
  chambersPerCell: number;
  /** Suspension line length (links to canopy), as a fraction of span. */
  lineLengthRatio: number;
  /** Built-in trim incidence of the canopy, degrees. Negative is nose down. */
  riggingAngleDeg: number;
  /**
   * Maximum extra nose-down incidence from fully pulled front risers, degrees.
   * The A and B lines sit about half a chord ahead of the C and D lines, so
   * 8 degrees is some 17 cm of riser.
   */
  frontRiserMaxDeg: number;
  /**
   * How far a single fully pulled front riser tips the whole canopy towards
   * its side (that side's lines get shorter), degrees.
   */
  frontRiserRollDeg: number;
  /** Canopy profile drag coefficient (airfoil, open nose, seams, slider). */
  canopyCd0: number;
  /** Pilot drag area Cd*A, m^2. */
  pilotDragArea: number;
  /** Total suspension line length times diameter, as drag area per m^2 of canopy. */
  lineDragPerArea: number;
  /** Cells across the span, for the picture only: 9 on a sport main, 7 on most reserves. */
  cells: number;
}

export const DEFAULT_RIG: RigConfig = {
  canopyAreaFt2: 170,
  exitWeightKg: 90,
  aspectRatio: 2.65,
  spanEfficiency: 0.8,
  chambersPerCell: 2,
  lineLengthRatio: 0.55,
  riggingAngleDeg: -10,
  frontRiserMaxDeg: 8,
  frontRiserRollDeg: 16,
  canopyCd0: 0.075,
  pilotDragArea: 0.6,
  lineDragPerArea: 0.0125,
  cells: 9,
};

export type CanopyKind = 'classic' | 'triCell';

/**
 * What cross-bracing changes, on top of the plain canopy above. These are
 * estimates: nobody has published the polar of either. Diagonal ribs hold the
 * top skin flat between line attachments, so the wing keeps its shape (more
 * of the planform works), the airfoil can be thinner and cleaner (less
 * profile drag), and a third of the ribs need no lines (less line drag).
 * Designers spend that on a steeper trim: faster, a longer recovery arc and
 * more speed left for the flare.
 */
export const TRI_CELL: Partial<RigConfig> = {
  chambersPerCell: 3,
  aspectRatio: 2.75,
  spanEfficiency: 0.9,
  riggingAngleDeg: -11.5,
  canopyCd0: 0.055,
  lineDragPerArea: 0.008,
};

/**
 * A reserve: seven cells of low-porosity fabric, broader and blunter than a
 * main, built to open fast and land gently rather than to fly fast. Estimates
 * again, from what reserves are known to do: slower and a little steeper than
 * a main of the same size.
 */
export const RESERVE: Partial<RigConfig> = {
  cells: 7,
  chambersPerCell: 2,
  aspectRatio: 2.2,
  spanEfficiency: 0.78,
  canopyCd0: 0.085,
  lineDragPerArea: 0.014,
};

/** Reserve sizes on sale, ft². */
export const RESERVE_SIZES = [113, 126, 143, 160, 176, 193, 218, 235, 253, 281];
/** The most a reserve is loaded with here, lb/ft²: reserves are chosen to land anyone gently. */
const RESERVE_MAX_LOADING = 1.25;

/** The reserve a jumper of this weight packs: the smallest that keeps the loading gentle. */
export function reserveSize(exitWeightKg: number): number {
  const lb = exitWeightKg * KG_TO_LB;
  return RESERVE_SIZES.find((size) => lb / size <= RESERVE_MAX_LOADING) ?? RESERVE_SIZES[RESERVE_SIZES.length - 1]!;
}

/** The reserve's configuration under a weight. */
export const reserveConfig = (exitWeightKg: number): RigConfig => ({
  ...DEFAULT_RIG,
  ...RESERVE,
  canopyAreaFt2: reserveSize(exitWeightKg),
  exitWeightKg,
});

/** The full configuration of a canopy of a kind and size under a weight. */
export const rigConfig = (kind: CanopyKind, canopyAreaFt2: number, exitWeightKg: number): RigConfig => ({
  ...DEFAULT_RIG,
  ...(kind === 'triCell' ? TRI_CELL : {}),
  canopyAreaFt2,
  exitWeightKg,
});

/** Section aerodynamics shared by every panel of the canopy. */
export interface AeroParams {
  /** Lift curve slope of the finite wing, per radian. */
  clAlpha: number;
  /** Zero-lift angle of attack, radians. */
  alpha0: number;
  /** Lift coefficient added by full brakes. */
  clBrake: number;
  /** Profile drag coefficient. */
  cd0: number;
  /** Profile drag coefficient added by full brakes. */
  cdBrake: number;
  /** Drag coefficient for flow along the span (sideways sliding). */
  cdSpan: number;
  /** Induced drag factor: CDi = kInduced * CL^2. */
  kInduced: number;
  /** Stall angle with no brakes, radians. */
  alphaStall0: number;
  /** Reduction of the stall angle at full brakes, radians. */
  alphaStallBrake: number;
  /** Negative stall angle (front collapse region), radians. */
  alphaStallNeg: number;
  /** Width of the stall transition, radians. */
  stallWidth: number;
  /** Lift coefficient the stalled wing settles to around 45 degrees. */
  clPlateau: number;
  /** Drag coefficient of the wing broadside to the flow. */
  cdPlate: number;
  /** Pitch damping of the section about its own quarter chord. */
  cmq: number;
  /**
   * Nose-down moment coefficient of full brakes: the lift of the pulled-down
   * tail acts well behind the quarter chord.
   */
  cmBrake: number;
  // Yaw moments of the canopy as a whole, as stability derivatives in the
  // usual aircraft form (reference area and span, yaw rate scaled by b/2V).
  // Summed sections alone weathercock about ten times harder than parafoils
  // identified in flight, and yaw-damp at the low end of the published range
  // (Mortaloni 2003, Slegers & Yakimenko 2009, Ward 2012 and 2014).
  /** Correction to the weathercock stability of the summed sections. */
  cnBeta: number;
  /** Yaw damping added to that of the summed sections. */
  cnr: number;
  /** Yaw moment coefficient of one fully pulled toggle. */
  cnBrake: number;
  /** Yaw moment coefficient of one fully pulled front riser. */
  cnFront: number;
}

export interface Panel {
  /** Position of the panel centre relative to the joint, canopy frame. */
  r: Vec3;
  /** Chord direction (towards the nose) at trim incidence, canopy frame. */
  forward: Vec3;
  /** Panel normal (upper surface side) at trim incidence, canopy frame. */
  normal: Vec3;
  /** Spanwise axis of the panel (forward x normal), canopy frame. */
  tangent: Vec3;
  /** Panel area, m^2. */
  area: number;
  /** -1 for the left half of the canopy, +1 for the right half. */
  side: -1 | 1;
  /**
   * How much of the toggle travel reaches this panel's trailing edge. Steering
   * lines pull the outer cells hardest and barely touch the centre.
   */
  brakeGain: number;
}

/** One of the two rigid bodies. Its frame has its origin at the joint. */
export interface BodyParams {
  /** Mass that resists acceleration, kg. */
  mass: number;
  /** Weight, N. Less than mass times g for the canopy: the air inside it weighs nothing. */
  weight: number;
  /** Height of the centre of mass above the joint, along the body Y axis, m. */
  cgY: number;
  /** Principal moments of inertia about the joint, body axes (pitch, yaw, roll). */
  inertia: Vec3;
}

/**
 * The harness, which joins the pilot to the risers. It is not a ball joint:
 * each direction behaves differently.
 */
export interface JointParams {
  /**
   * Roll. The pilot hangs from two points a shoulder width apart and cannot
   * roll away from the canopy: a stiff spring stands in for that. N m/rad.
   */
  rollStiffness: number;
  /** N m s/rad. */
  rollDamping: number;
  /**
   * Yaw. Each shoulder hangs from a front and a rear riser, which hold it in
   * place until one of the two goes slack: the pilot does not turn under the
   * canopy below this torque per newton of line tension, m.
   */
  yawHold: number;
  /** How far the pilot has turned by the time a riser goes slack, rad. */
  yawGive: number;
  /**
   * Past that the pilot hangs from one riser a side and turning winds them
   * round each other; they pull back in proportion to what they carry.
   * Torque per newton of line tension at a quarter turn, m.
   */
  yawArm: number;
  /** N m s/rad. */
  yawDamping: number;
  /**
   * Pitch. Free: the pilot swings about the line through the two riser
   * attachments. This is only the rubbing of the harness and the pilot
   * holding still. N m s/rad.
   */
  pitchDamping: number;
}

/**
 * Points are given in the frame of the body they belong to. Both frames have
 * their origin at the joint, where the risers meet the harness.
 */
export interface RigParams {
  config: RigConfig;
  area: number;
  span: number;
  chord: number;
  /** Suspension line length, which is also the radius of the canopy arc, m. */
  lineLength: number;
  /** Wing loading, lb/ft^2. */
  wingLoading: number;
  /** Mass that gravity acts on (pilot + gear), kg. */
  gravMass: number;
  /** Mass that resists acceleration (adds the air enclosed in the canopy), kg. */
  inertMass: number;
  /** Canopy, lines and risers. */
  canopy: BodyParams;
  pilot: BodyParams;
  joint: JointParams;
  aero: AeroParams;
  panels: Panel[];
  frontRiserMax: number;
  /** Canopy roll towards a single fully pulled front riser, radians. */
  frontRiserRoll: number;
  /** Pilot centre of mass, pilot frame. */
  pilotPos: Vec3;
  /** Point where line drag is applied, canopy frame. */
  linePos: Vec3;
  /** Top of the risers, where the lines converge, canopy frame. */
  linksPos: Vec3;
  /** Centre of the canopy, canopy frame. */
  canopyPos: Vec3;
  /** Pilot's eyes, pilot frame. */
  eyePos: Vec3;
  /** Pilot's feet when hanging in the harness, pilot frame. */
  feetPos: Vec3;
  pilotDragArea: number;
  lineDragArea: number;
}

const PANEL_COUNT = 8;
const RISER_ABOVE_PILOT_CG = 0.45;
const RISER_LENGTH = 0.5;
const EYES_ABOVE_PILOT_CG = 0.55;
const FEET_BELOW_PILOT_CG = 0.95;
/** Distance between the two riser attachments on the harness, m. */
const SHOULDER_WIDTH = 0.4;
/** Distance between the tops of the front and rear risers of one side, m. */
const RISER_SPREAD = 0.12;
/** A hanging 90 kg pilot with gear about its own centre of mass, kg m^2 (pitch, yaw, roll). */
const PILOT_INERTIA = vec3(10, 2, 10);
const PILOT_INERTIA_KG = 90;

export function deriveRig(config: RigConfig): RigParams {
  const area = config.canopyAreaFt2 * FT2_TO_M2;
  const span = Math.sqrt(area * config.aspectRatio);
  const chord = area / span;
  const lineLength = config.lineLengthRatio * span;

  // Masses. Fabric and lines scale with area, enclosed air with volume.
  const fabricMass = 0.22 * area;
  const enclosedAir = AIR_DENSITY_SEA_LEVEL * 0.07 * chord * area;
  const canopyMass = fabricMass + enclosedAir;
  const pilotMass = config.exitWeightKg - fabricMass;
  const inertMass = pilotMass + canopyMass;

  // Two bodies joined at the riser attachment. The canopy's mass sits at its
  // centre, a riser and a line length above the joint; the pilot's hangs below.
  const linksY = RISER_LENGTH;
  const canopyY = linksY + lineLength;
  const pilotY = -RISER_ABOVE_PILOT_CG;
  const canopy: BodyParams = {
    mass: canopyMass,
    weight: fabricMass * GRAVITY,
    cgY: canopyY,
    inertia: vec3(
      canopyMass * (canopyY * canopyY + (chord * chord) / 12), // pitch (X)
      (canopyMass * (span * span + chord * chord)) / 12, // yaw (Y)
      canopyMass * (canopyY * canopyY + (span * span) / 12), // roll (Z)
    ),
  };
  // A heavier pilot is the same shape with more mass.
  const heft = config.exitWeightKg / PILOT_INERTIA_KG;
  const pilot: BodyParams = {
    mass: pilotMass,
    weight: pilotMass * GRAVITY,
    cgY: pilotY,
    inertia: vec3(
      PILOT_INERTIA.x * heft + pilotMass * pilotY * pilotY,
      PILOT_INERTIA.y * heft,
      PILOT_INERTIA.z * heft + pilotMass * pilotY * pilotY,
    ),
  };

  // Roll: stiff enough to hold the pilot within a fraction of a degree, soft
  // enough for the time step (4 Hz), and critically damped.
  const rollInertia = PILOT_INERTIA.z * heft;
  const rollStiffness = rollInertia * (2 * Math.PI * 4) ** 2;
  const joint: JointParams = {
    rollStiffness,
    rollDamping: 2 * Math.sqrt(rollStiffness * rollInertia),
    // A shoulder pushed forward takes the load off its rear riser, and all of
    // it once the push is the load times half the spread over the length. In
    // level flight that holds the pilot square up to about 20 N m.
    yawHold: (SHOULDER_WIDTH * RISER_SPREAD) / (4 * RISER_LENGTH),
    yawGive: 2 * DEG,
    // Two risers a shoulder width apart: a bifilar pendulum, about
    // 70 N m/rad in level flight, which swings the pilot back in a second.
    yawArm: (SHOULDER_WIDTH * SHOULDER_WIDTH) / (4 * RISER_LENGTH),
    yawDamping: 25,
    pitchDamping: 50,
  };

  // Finite wing lift slope from lifting-line theory; ram-air sections are a
  // little less efficient than a clean airfoil.
  const a0 = 2 * Math.PI * 0.9;
  const efficiency = config.spanEfficiency;
  const clAlpha = a0 / (1 + a0 / (Math.PI * config.aspectRatio * efficiency));
  const aero: AeroParams = {
    clAlpha,
    alpha0: -6 * DEG,
    clBrake: 0.9,
    cd0: config.canopyCd0,
    // Brake drag also powers the flare: lowering it costs the plane-out.
    cdBrake: 0.3,
    // Sideways drag high above the pilot: it levels the canopy once a turn is
    // released, and too much of it keeps a held spiral from steepening.
    cdSpan: 0.1,
    kInduced: 1 / (Math.PI * config.aspectRatio * efficiency),
    alphaStall0: 18 * DEG,
    alphaStallBrake: 0 * DEG,
    alphaStallNeg: -12 * DEG,
    stallWidth: 2 * DEG,
    clPlateau: 0.95,
    cdPlate: 1.4,
    // Thin airfoil value (pi/8) reduced for a low aspect ratio wing.
    cmq: (Math.PI / 8) * 0.6,
    cmBrake: 0.25,
    // Leaves about +0.01, where flight-identified models sit (-0.002 to +0.015).
    cnBeta: -0.07,
    // With the sections' own -0.07 this is the -0.27 of Slegers & Yakimenko.
    cnr: -0.2,
    // Set by the height a turn costs, which nobody has published: a skydiver's
    // judgement that two buried-toggle 360s cannot be flown from 100 m. More
    // yaw power spins the canopy round faster than it sinks. Both went up a
    // little with the two-body model: the air inside the canopy has mass but
    // no weight, so a turn slings it outwards and levels the canopy.
    cnBrake: 0.065,
    cnFront: 0.032,
  };

  // Panels sit on a circular arc centred on the links, where the lines meet
  // at the top of the risers.
  const halfAngle = span / (2 * lineLength);
  const rig = config.riggingAngleDeg * DEG;
  const panels: Panel[] = [];
  for (let i = 0; i < PANEL_COUNT; i++) {
    const theta = -halfAngle + ((i + 0.5) / PANEL_COUNT) * 2 * halfAngle;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    // Untrimmed frame: forward (0,0,-1), normal (sin, cos, 0). Then pitch by
    // the rigging angle about the spanwise axis (positive = nose up).
    const cr = Math.cos(rig);
    const sr = Math.sin(rig);
    panels.push({
      r: vec3(lineLength * sin, linksY + lineLength * cos, 0),
      forward: vec3(sr * sin, sr * cos, -cr),
      normal: vec3(cr * sin, cr * cos, sr),
      tangent: vec3(cos, -sin, 0),
      area: area / PANEL_COUNT,
      side: theta < 0 ? -1 : 1,
      brakeGain: 0.5 + Math.abs(theta / halfAngle),
    });
  }

  return {
    config,
    area,
    span,
    chord,
    lineLength,
    wingLoading: (config.exitWeightKg * KG_TO_LB) / config.canopyAreaFt2,
    gravMass: config.exitWeightKg,
    inertMass,
    canopy,
    pilot,
    joint,
    aero,
    panels,
    frontRiserMax: config.frontRiserMaxDeg * DEG,
    frontRiserRoll: config.frontRiserRollDeg * DEG,
    pilotPos: vec3(0, pilotY, 0),
    linePos: vec3(0, linksY + lineLength * 0.5, 0),
    linksPos: vec3(0, linksY, 0),
    canopyPos: vec3(0, canopyY, 0),
    eyePos: vec3(0, pilotY + EYES_ABOVE_PILOT_CG, 0),
    feetPos: vec3(0, pilotY - FEET_BELOW_PILOT_CG, 0),
    pilotDragArea: config.pilotDragArea,
    lineDragArea: config.lineDragPerArea * area,
  };
}
