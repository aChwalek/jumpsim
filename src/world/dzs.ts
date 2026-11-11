// The drop zones on offer. The real ones carry megabytes of data and photos:
// they are loaded the first time they are chosen.

import { createValbrise, type DzPack } from './dz';
import { createPujaut } from './pujaut';
import { createRealDz, type RealDzData, type RealDzLook } from './real';
import { LOOKS } from './realDzs';

export type DzId = 'valbrise' | 'pujaut' | 'empuriabrava' | 'chambery' | 'guadeloupe';

export interface DzInfo {
  id: DzId;
  name: string;
  /** One line under the name in the menu. */
  note: string;
  /** Where it is, degrees, and its clock (local time minus UTC, h): the sun depends on them. */
  lat: number;
  lon: number;
  utcOffsetH: number;
  /** The wind the place usually gets: from, m/s. */
  wind: { fromDeg: number; speed: number };
  /** Where its data comes from, as the licences ask to say. */
  credit?: string;
  /** Finals along this axis rather than straight into the wind, see DzPack. */
  landingAxisDeg?: number;
  /** Heights of the three starts above the ground, m. */
  starts: { pattern: number; final: number; plane: number };
  /** The pack, if it has been loaded. */
  loaded(): DzPack | undefined;
  /** Loads the pack, the first time only. */
  load(): Promise<DzPack>;
}

/** A drop zone built on the spot, from code. */
function built(id: DzId, name: string, note: string, create: () => DzPack, credit?: string): DzInfo {
  let pack: DzPack | undefined;
  const get = (): DzPack => (pack ??= create());
  return {
    id,
    name,
    note,
    credit,
    get lat() {
      return get().lat;
    },
    get lon() {
      return get().lon;
    },
    get utcOffsetH() {
      return get().utcOffsetH ?? 2;
    },
    get wind() {
      return get().wind;
    },
    get landingAxisDeg() {
      return get().landingAxisDeg;
    },
    get starts() {
      const p = get();
      return { pattern: p.pattern.height, final: p.final.height, plane: p.jumpRun.height };
    },
    loaded: get,
    load: async () => get(),
  };
}

/** A real drop zone: its look comes with the code, its data on demand. */
function real(id: DzId & keyof typeof LOOKS, note: string, credit: string, data: () => Promise<{ DATA: RealDzData }>): DzInfo {
  const look: RealDzLook & { lat: number; lon: number; utcOffsetH: number } = LOOKS[id];
  let pack: DzPack | undefined;
  let loading: Promise<DzPack> | undefined;
  return {
    id,
    name: look.name,
    note,
    credit,
    landingAxisDeg: look.landingAxisDeg,
    starts: { pattern: look.pattern.height, final: look.final.height, plane: look.jumpRun.height },
    lat: look.lat,
    lon: look.lon,
    utcOffsetH: look.utcOffsetH,
    wind: look.wind,
    loaded: () => pack,
    load: () =>
      (loading ??= data().then(({ DATA }) => {
        pack = createRealDz(DATA, look);
        return pack;
      })),
  };
}

const PUJAUT_CREDIT = 'Carte © OpenStreetMap · relief IGN · carte VAC SIA';
const MAP = 'Sentinel-2 cloudless (EOX, Copernicus) · © OpenStreetMap · relief Mapzen';
const FRANCE = `Photos IGN, ${MAP}`;
const SPAIN = `Photos PNOA © IGN España, ${MAP}`;

export const DZS: DzInfo[] = [
  built('valbrise', 'Valbrise', 'Imaginaire, plat, avec un pond', createValbrise),
  built('pujaut', 'Pujaut', 'Skydive Pujaut (LFNT)', createPujaut, PUJAUT_CREDIT),
  real('chambery', 'Savoie Parachutisme (LFLB)', FRANCE, () => import('./data/chambery')),
  real('empuriabrava', 'Skydive Empuriabrava (LEAP)', SPAIN, () => import('./data/empuriabrava')),
  real('guadeloupe', 'Caraïbe Parachutisme (TFFC)', FRANCE, () => import('./data/guadeloupe')),
];

export function dzInfo(id: DzId): DzInfo {
  return DZS.find((d) => d.id === id) ?? DZS[0]!;
}
