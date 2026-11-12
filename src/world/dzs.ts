// The drop zones on offer. The real ones carry megabytes of data and photos:
// they are loaded the first time they are chosen.

import { T } from '../i18n';
import type { AircraftId } from '../sim/plane';
import { createValbrise, type DzPack } from './dz';
import { createPujaut } from './pujaut';
import { createRealDz, type RealDzData, type RealDzLook } from './real';
import { LOOKS } from './realDzs';
import { TOWER_HEIGHT, createTowerZone } from './tower';

export type DzId = 'valbrise' | 'tower' | 'pujaut' | 'empuriabrava' | 'chambery' | 'guadeloupe' | 'lauterbrunnen' | 'limska' | 'millau' | 'brento';

export interface DzInfo {
  id: DzId;
  name: string;
  /** The club that runs it and the airfield's ICAO code, for the real ones. */
  club?: string;
  icao?: string;
  /** One line about the place, in the language in use. */
  readonly note: string;
  /** Where it is, degrees, and its clock (local time minus UTC, h): the sun depends on them. */
  lat: number;
  lon: number;
  utcOffsetH: number;
  /** The wind the place usually gets: from, m/s. */
  wind: { fromDeg: number; speed: number };
  /** Where its data comes from, as the licences ask to say. */
  readonly credit?: string;
  /** Finals along this axis rather than straight into the wind, see DzPack. */
  landingAxisDeg?: number;
  /** Heights of the three starts above the ground, m. */
  starts: { pattern: number; final: number; plane: number };
  /** The plane that flies jump run there. */
  aircraft: AircraftId;
  /** An object to BASE jump from, its height, m, and whether one stands at its edge rather than run to it (a bridge). */
  base?: { height: number; standing?: boolean };
  /** The pack, if it has been loaded. */
  loaded(): DzPack | undefined;
  /** Loads the pack, the first time only. */
  load(): Promise<DzPack>;
}

type Credit = keyof typeof T.dz.credits;

/** A drop zone built on the spot, from code. */
function built(
  id: DzId & keyof typeof T.dz.notes,
  name: string,
  create: () => DzPack,
  club?: { name: string; icao: string; credit: Credit },
  base?: { height: number },
): DzInfo {
  let pack: DzPack | undefined;
  const get = (): DzPack => (pack ??= create());
  return {
    id,
    name,
    club: club?.name,
    icao: club?.icao,
    base,
    get note() {
      return T.dz.notes[id];
    },
    get credit() {
      return club ? T.dz.credits[club.credit] : undefined;
    },
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
    get aircraft() {
      return get().jumpRun.aircraft ?? 'pc6';
    },
    loaded: get,
    load: async () => get(),
  };
}

/** A real drop zone, or a real BASE site: its look comes with the code, its data on demand. */
function real(
  id: DzId & keyof typeof LOOKS,
  club: string,
  icao: string | undefined,
  credit: Credit,
  data: () => Promise<{ DATA: RealDzData }>,
  base?: { height: number; standing?: boolean },
): DzInfo {
  const look: RealDzLook & { lat: number; lon: number; utcOffsetH: number } = LOOKS[id];
  let pack: DzPack | undefined;
  let loading: Promise<DzPack> | undefined;
  return {
    id,
    name: look.name,
    club,
    icao,
    base,
    get note() {
      return T.dz.notes[id];
    },
    get credit() {
      return T.dz.credits[credit];
    },
    landingAxisDeg: look.landingAxisDeg,
    starts: { pattern: look.pattern.height, final: look.final.height, plane: look.jumpRun.height },
    aircraft: look.jumpRun.aircraft ?? 'pc6',
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

export const DZS: DzInfo[] = [
  built('valbrise', 'Valbrise', createValbrise),
  built('tower', 'Valbrise BASE', createTowerZone, undefined, { height: TOWER_HEIGHT }),
  built('pujaut', 'Pujaut', createPujaut, { name: 'Skydive Pujaut', icao: 'LFNT', credit: 'pujaut' }),
  real('chambery', 'Savoie Parachutisme', 'LFLB', 'france', () => import('./data/chambery')),
  real('empuriabrava', 'Skydive Empuriabrava', 'LEAP', 'spain', () => import('./data/empuriabrava')),
  real('guadeloupe', 'Caraïbe Parachutisme', 'TFFC', 'france', () => import('./data/guadeloupe')),
  // High Nose: the height down to the landing field, as in tools/dz/lauterbrunnen.json.
  real('lauterbrunnen', 'High Nose', undefined, 'swiss', () => import('./data/lauterbrunnen'), { height: 545 }),
  // The A9 viaduct: the road's height above the landing field, as built into data/limska.ts.
  real('limska', 'Vijadukt Limska Draga', undefined, 'croatia', () => import('./data/limska'), { height: 115, standing: true }),
  // The A75 viaduct: the road's height above the landing field at the exit, as built into data/millau.ts.
  real('millau', 'Viaduc de Millau', undefined, 'franceAlti', () => import('./data/millau'), { height: 277, standing: true }),
  // The Becco dell'Aquila: the height down to the landing field, as in tools/dz/brento.json.
  real('brento', "Becco dell'Aquila", undefined, 'trentino', () => import('./data/brento'), { height: 1185 }),
];

export function dzInfo(id: DzId): DzInfo {
  return DZS.find((d) => d.id === id) ?? DZS[0]!;
}
