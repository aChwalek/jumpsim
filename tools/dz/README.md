# Real drop zones

`build.py` turns open data into a drop zone for the simulator:

```
python3 tools/dz/build.py <id>            # everything
python3 tools/dz/build.py <id> --only osm # one step: relief, imagery, osm (or none: rewrite the module only)
```

It needs Python 3 and ffmpeg, nothing else. Downloads are cached in
`~/.cache/jumpsim-dz` (about 30 MB a drop zone), so a second run is quick.

## Inputs

`tools/dz/<id>.json` holds what is specific to the drop zone, in WGS84
latitude and longitude: the centre of the main landing area (the origin of
the local frame), the aerodrome outline, runways, paved areas, landing areas,
target, the DZ's own buildings, windsocks, and notes on where each fact came
from. These were read off the aerodrome charts, the DZ's own pages and the
aerial photos; what is guessed is listed in the file under `invented`.

`src/world/realDzs.ts` holds what the data cannot say: wall colours, tree
heights, where people stand, the usual wind, the pattern and the jump run.

## Outputs

- `public/dz/<id>/near.jpg`: 4.1 km square at 1 m a pixel, orthophotos.
- `public/dz/<id>/mid.jpg`: 16.4 km square at 4 m a pixel, orthophotos.
- `public/dz/<id>/far.jpg`: 82 km square at 40 m a pixel, Sentinel-2.
- `src/world/data/<id>.ts`: relief (12 km at 100 m, 80 km at 500 m),
  buildings within 3 km, woods within 4.5 km, water, the sea, the aerodrome.

The local frame is web mercator scaled to true size at the origin: x east,
z south, metres. The photos map onto it with no resampling distortion.

## Sources and licences

- Orthophotos, France and overseas: IGN BD ORTHO, Géoplateforme WMTS,
  Licence Ouverte / Etalab 2.0.
- Orthophotos, Spain: PNOA, © Instituto Geográfico Nacional de España,
  CC BY 4.0 (scne.es).
- Satellite, everywhere: Sentinel-2 cloudless 2023 by EOX IT Services GmbH
  (contains modified Copernicus Sentinel data 2023), CC BY-NC-SA 4.0: fine for
  this non-commercial project, the attribution must stay.
- Relief: Mapzen / AWS Terrain Tiles (SRTM, EU-DEM, GMTED, ETOPO1 and
  others), see their attribution list.
- Map data: © OpenStreetMap contributors, ODbL.
