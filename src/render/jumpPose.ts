import type { Jump } from '../sim/jump';
import type { RigFrame } from './rigView';
import { doorStance, type Stance } from './posture';

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How a jumper holds the body at this point of the jump; hanging under the canopy with no jump. */
export function jumpStance(jump: Jump | null): Stance {
  if (!jump) return 'hanging';
  switch (jump.phase) {
    case 'standing':
      return 'ground';
    case 'plane':
      return doorStance(jump.spot, jump.plane!.type.doorSide);
    case 'freefall':
      // Just cut away: the hands are still on the handles.
      if (jump.cutawayAt !== null && jump.time - jump.cutawayAt < 0.45) return 'cutaway';
      return jump.body.track > 0.5 ? 'track' : jump.body.position;
    case 'opening':
      if (jump.inflation !== null) return 'hanging';
      if (jump.canopy === 'reserve') return jump.log.reserveBy === 'hand' ? 'reserve' : 'belly';
      return jump.opening?.stage === 'throw' ? 'throw' : 'belly';
    default:
      return 'hanging';
  }
}

/** Where the pilot chute and bag of the canopy overhead are. */
export function deployStage(jump: Jump | null, out: Pick<RigFrame, 'deploy' | 'deployTime' | 'bagOut'>): void {
  out.bagOut = 0;
  out.deployTime = 0;
  if (!jump) {
    // Started under canopy: it has long been open.
    out.deploy = 'canopy';
    out.deployTime = 10;
    out.bagOut = 1;
    return;
  }
  const reserve = jump.canopy === 'reserve';
  const o = jump.opening;
  if (jump.phase === 'canopy') {
    out.deploy = reserve ? 'free' : 'canopy';
    out.deployTime = 10;
    out.bagOut = 1;
  } else if (jump.phase !== 'opening' || !o) {
    out.deploy = 'stowed';
  } else if (o.stage === 'throw') {
    out.deploy = 'hand';
    out.deployTime = o.time;
  } else if (o.stage === 'bag') {
    // The pilot chute inflates and the bridle comes tight, then the bag lifts off.
    const lift = o.timing.throwOut + (reserve ? 0.15 : 0.45);
    if (o.time < lift) {
      out.deploy = 'tow';
      out.deployTime = o.time - o.timing.throwOut;
    } else {
      out.deploy = 'bag';
      out.deployTime = o.time - lift;
      out.bagOut = ease((o.time - lift) / Math.max(0.1, o.timing.lineStretch - lift));
    }
  } else {
    // A reserve's free bag lets go once the canopy is out of it and filling.
    out.deploy = reserve && o.inflation > 0.6 ? 'free' : 'canopy';
    out.deployTime = o.time - o.timing.lineStretch;
    out.bagOut = 1;
  }
}
