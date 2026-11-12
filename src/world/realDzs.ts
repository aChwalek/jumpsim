// What the open data cannot tell about each real drop zone: where it is for
// the sun and its clock, its usual wind, the colours of its walls and grass,
// how tall its trees grow, and how the pattern is flown. The data itself is
// in ./data, built by tools/dz/build.py from tools/dz/<id>.json, where the
// sources of each fact are noted.

import type { RealDzLook } from './real';

type Look = RealDzLook & { lat: number; lon: number; utcOffsetH: number };

const kmh = (v: number): number => v / 3.6;

export const LOOKS = {
  // Savoie Parachutisme on Chambéry-Savoie airport (LFLB), at the south end
  // of the Lac du Bourget, between the Mont du Chat and the Revard.
  chambery: {
    name: 'Chambéry',
    lat: 45.630281,
    lon: 5.877298,
    utcOffsetH: 2,
    // The lake breeze, from the north from late morning: three summer afternoons in four.
    wind: { fromDeg: 0, speed: kmh(10) },
    grass: { rough: 0x7f7a50, mown: 0x5a7d3c },
    walls: [0xe9e4da, 0xd8cfbf, 0xf0ebe0, 0xcfc6b4, 0xe2d6c0],
    roofs: [0x6f6a66, 0x8a4a36, 0x5d5f62, 0x9a5a40],
    woods: {
      w: { height: [12, 24], perHectare: 24 },
      s: { height: [2, 5], perHectare: 10 },
      o: { height: [4, 6], perHectare: 40 },
      m: { height: [6, 12], perHectare: 15 },
    },
    rowHeight: [10, 18],
    // The landing strip runs north-south west of the runway: finals along it,
    // facing the lake unless the wind is from the south. The pattern is
    // always flown west of it, never over the runway: left-hand landing
    // north, right-hand landing south. Meeting point at 250 m.
    landingAxisDeg: 357,
    patternSideDeg: 270,
    pattern: { upwind: 180, side: 190, height: 250 },
    final: { downwind: 220, height: 80 },
    // Pilatus PC-6, 4000 m above the ground.
    jumpRun: { downwind: 500, offset: 60, height: 4000, indicatedAirspeed: 39 },
  },
  // Skydive Empuriabrava (LEAP), between the canal town and the wetlands of
  // the Aiguamolls de l'Empordà.
  empuriabrava: {
    name: 'Empuriabrava',
    lat: 42.2597,
    lon: 3.110845,
    utcOffsetH: 2,
    // The afternoon sea breeze, from the east-south-east.
    wind: { fromDeg: 120, speed: kmh(15) },
    grass: { rough: 0x8f8160, mown: 0x87865f },
    walls: [0xf1ece2, 0xe8dcc4, 0xf3efe8, 0xe2c9a0, 0xefe3cf],
    roofs: [0xb5603c, 0xa8553a, 0xc2714a, 0x9a8f86],
    woods: {
      w: { height: [8, 16], perHectare: 22 },
      s: { height: [2, 4], perHectare: 10 },
      o: { height: [3, 4.5], perHectare: 60 },
      m: { height: [4, 9], perHectare: 15 },
    },
    rowHeight: [8, 14],
    // The landing area is the long grass east of the runway, a hundred metres
    // wide: finals along it. The pattern stays east of it, over the karting
    // and the fields, so that nobody crosses the runway low: left-hand with
    // the sea breeze, right-hand with the tramontana.
    landingAxisDeg: 163.4,
    patternSideDeg: 73.4,
    pattern: { upwind: 180, side: 150, height: 300 },
    final: { downwind: 240, height: 80 },
    // Twin Otter and Pilatus Porter, up to 4000 m.
    jumpRun: { downwind: 500, offset: 60, height: 4000, indicatedAirspeed: 41 },
  },
  // Caraïbe Parachutisme on Saint-François aerodrome (TFFC), at the east end
  // of Grande-Terre, between the golf course, the marina and the reef.
  guadeloupe: {
    name: 'Guadeloupe',
    lat: 16.258018,
    lon: -61.266291,
    utcOffsetH: -4,
    // The trade wind, from east to south-east nearly every day.
    wind: { fromDeg: 100, speed: kmh(20) },
    grass: { rough: 0x8a8058, mown: 0x9b936e },
    walls: [0xf2efe6, 0xe9e2cf, 0xf0d9b5, 0xd8e6e0, 0xf4f1ea, 0xe8c9a8],
    roofs: [0xb04a32, 0x8a8f94, 0x3c6e9a, 0xd0d4d6],
    woods: {
      w: { height: [6, 12], perHectare: 20 },
      s: { height: [2.5, 5], perHectare: 12 },
      o: { height: [3, 6], perHectare: 40 },
      m: { height: [4, 8], perHectare: 30 },
    },
    rowHeight: [6, 10],
    // Left-hand, final into the trade wind over the west arm of the zone:
    // inferred, nothing is published.
    pattern: { upwind: 200, side: 150, height: 300 },
    final: { downwind: 260, height: 90 },
    // Cessna 206, 3200 m for the licensed jumpers.
    jumpRun: { downwind: 500, offset: 60, height: 3200, indicatedAirspeed: 40 },
  },
} satisfies Record<string, Look>;
