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
  // Lauterbrunnen: no drop zone, a BASE site. High Nose on the Mürrenfluh,
  // and a meadow on the valley floor 470 m out from it.
  lauterbrunnen: {
    name: 'Lauterbrunnen',
    lat: 46.577912,
    lon: 7.910929,
    utcOffsetH: 2,
    // The valley wind, up the valley from the north in the afternoon; mornings are calm.
    wind: { fromDeg: 0, speed: kmh(9) },
    grass: { rough: 0x5f7f34, mown: 0x6a8c3a },
    // Chalets: dark larch, light stone, white render.
    walls: [0x7a4e2e, 0x8a5a36, 0x6b4428, 0xe9e4d8, 0xd9d2c2],
    roofs: [0x55504c, 0x6a625c, 0x8a3e2a, 0x4a4643],
    woods: {
      w: { height: [18, 32], perHectare: 30, slim: true },
      s: { height: [2, 5], perHectare: 10 },
    },
    rowHeight: [10, 20],
    // The valley floor slopes: only the meadow itself is laid flat.
    relief: { flatBelow: 2, blend: 8 },
    // Along the valley, the pattern on the east side, over the floor between
    // the meadow and the river, away from the wall.
    landingAxisDeg: 0,
    patternSideDeg: 90,
    pattern: { upwind: 120, side: 110, height: 150 },
    final: { downwind: 150, height: 50 },
    // From the air too: the helicopter jumps over the valley go from about 4000 m.
    jumpRun: { downwind: 500, offset: 60, height: 3200, indicatedAirspeed: 39 },
  },
  // Limska draga: no drop zone, a BASE site. The A9 viaduct over the dry
  // valley north of Kanfanar, and the field on the valley floor under it.
  limska: {
    name: 'Limska Draga',
    lat: 45.120287,
    lon: 13.800407,
    utcOffsetH: 2,
    // The sea breeze up the Lim channel and the valley, from the south-west, in the afternoon.
    wind: { fromDeg: 225, speed: kmh(8) },
    grass: { rough: 0x707a3c, mown: 0x7a8644 },
    // Istrian stone and render, terracotta roofs.
    walls: [0xd8d0c0, 0xc9bfa9, 0xe6e0d2, 0xb8ab90],
    roofs: [0x9a5a40, 0x8a4a36, 0xa86a4a, 0x6f6a66],
    woods: {
      // Downy oak and hornbeam on the karst: low woods.
      w: { height: [8, 15], perHectare: 35 },
      s: { height: [2, 5], perHectare: 12 },
      o: { height: [4, 6], perHectare: 40 },
      v: { height: [1.5, 2], perHectare: 60 },
    },
    rowHeight: [6, 12],
    // The valley floor is narrow and slopes: only the field itself is laid flat.
    relief: { flatBelow: 2, blend: 8 },
    // Along the field, which follows the valley; the pattern over the track on its west side.
    landingAxisDeg: 24,
    patternSideDeg: 294,
    pattern: { upwind: 60, side: 45, height: 80 },
    final: { downwind: 90, height: 35 },
    // Nobody jumps here from a plane: a start from the air only so that one exists.
    jumpRun: { downwind: 400, offset: 60, height: 1200, indicatedAirspeed: 39 },
  },
  // Millau: no drop zone, a BASE site, and a forbidden one. The A75 viaduct
  // over the Tarn, and the meadow on the south bank under its main span.
  millau: {
    name: 'Millau',
    lat: 44.08389,
    lon: 3.02,
    utcOffsetH: 2,
    // The valley wind, up the Tarn from the west-south-west in the afternoon.
    wind: { fromDeg: 240, speed: kmh(10) },
    grass: { rough: 0x7d7f48, mown: 0x86894e },
    // Limestone of the causses and render, tiled or slate roofs.
    walls: [0xe2dccd, 0xd4cbb6, 0xc9bfa6, 0xeae5d8],
    roofs: [0x9a5a40, 0x8a4a36, 0x6f6a66, 0x5d5f62],
    woods: {
      // Downy oak, Scots pine and box on the slopes, poplars and ash along the river.
      w: { height: [10, 18], perHectare: 30 },
      s: { height: [2, 5], perHectare: 12 },
      o: { height: [4, 6], perHectare: 40 },
      v: { height: [1.5, 2], perHectare: 60 },
    },
    rowHeight: [10, 18],
    // The meadow slopes gently up from the river: only it is laid flat.
    relief: { flatBelow: 2, blend: 8 },
    // Along the meadow, which follows the river; the pattern over the river on its north-west side.
    landingAxisDeg: 53,
    patternSideDeg: 323,
    pattern: { upwind: 70, side: 50, height: 90 },
    final: { downwind: 110, height: 40 },
    // Nobody jumps here from a plane: a start from the air only so that one exists.
    jumpRun: { downwind: 400, offset: 60, height: 1500, indicatedAirspeed: 39 },
  },
  // Monte Brento: no drop zone, a BASE site, the most jumped exit in the
  // world. The Becco dell'Aquila on the rim of the wall over the Sarca valley,
  // and the campo Gaggiolo on the valley floor 1.7 km out from it.
  brento: {
    name: 'Monte Brento',
    lat: 45.992674,
    lon: 10.926101,
    utcOffsetH: 2,
    // The Ora del Garda, up the valley from the lake from late morning.
    wind: { fromDeg: 190, speed: kmh(10) },
    grass: { rough: 0x6b7a3a, mown: 0x74883f },
    // Trentino stone and render, a few wooden barns.
    walls: [0xe6e0d4, 0xd8cdb8, 0xefe9de, 0xc9bca4, 0x8a6a4a],
    roofs: [0x8a4a36, 0x6f6a66, 0x9a5a40, 0x55504c],
    woods: {
      // Hop hornbeam, manna ash and oak on the limestone, pines higher up.
      w: { height: [10, 20], perHectare: 30 },
      s: { height: [2, 5], perHectare: 12 },
      o: { height: [3, 5], perHectare: 50 },
      v: { height: [1.5, 2.2], perHectare: 60 },
    },
    rowHeight: [6, 14],
    // The valley floor slopes: only the field itself is laid flat.
    relief: { flatBelow: 2, blend: 8 },
    // Along the valley, the pattern over the road and the river on the east
    // side, away from the wall.
    landingAxisDeg: 10,
    patternSideDeg: 100,
    pattern: { upwind: 110, side: 100, height: 150 },
    final: { downwind: 140, height: 50 },
    // Nobody jumps here from a plane: a start from the air, over the valley, only so that one exists.
    jumpRun: { downwind: 500, offset: 60, height: 2000, indicatedAirspeed: 39 },
  },
} satisfies Record<string, Look>;
