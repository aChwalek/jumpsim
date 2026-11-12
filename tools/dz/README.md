# Real drop zones

`build.py` turns open data into a drop zone for the simulator:

```
python3 tools/dz/build.py <id>            # everything
python3 tools/dz/build.py <id> --only osm # one step: relief, imagery, osm (or none: rewrite the module only)
```

It needs Python 3 and ffmpeg, nothing else, except for a fine relief from
swissALTI3D or the Province of Trento's LiDAR (below), which reads GeoTIFFs
with numpy and Pillow. Downloads are cached in
`~/.cache/jumpsim-dz` (about 30 MB a drop zone), so a second run is quick.

## Inputs

`tools/dz/<id>.json` holds what is specific to the drop zone, in WGS84
latitude and longitude: the centre of the main landing area (the origin of
the local frame), the aerodrome outline, runways, paved areas, landing areas,
target, the DZ's own buildings, windsocks, and notes on where each fact came
from. These were read off the aerodrome charts, the DZ's own pages and the
aerial photos; what is guessed is listed in the file under `invented`.

A BASE site has no aerodrome: `runways` is empty, the landing field is its
only landing area, and `base` gives the exit (where the run starts, its
heading, its length and the height down to the landing field). A cliff or a
narrow valley needs finer relief than the near grid gives: `fineRelief` lays a
square of it over the near grid, sampled from a national survey where one is
open (`survey`: `swissalti3d` in Switzerland, `rgealti` in France, through the
Géoplateforme's altimetry service, `pat` in Trentino), else from the terrain
tiles at their finest (`terrarium`), which follow a valley floor better than
the 100 m grid but know no more than the tiles do.

`bridges` lists decks to draw and make solid: the ends of the OSM way, the
road's height (absolute, m), the width, the published spans and where the
first pier stands along the way, the girder's depth at the piers and
mid-span. One the orthophotos show (`inPhotos`) is painted out of them, since
it would otherwise lie flat on the valley floor under the one drawn. A deck may
also curve (`radius_m`, positive if it bends right from the first end to the
second; spans are then measured along the arc), climb (`grade`, from the first
end, whose road `deckTop_m` is), carry wind screens (`parapet_m`), a girder of
its own width and colour (`girderShare`, `paintHex`), piers of their own shape
(`pierShape`: tapered, split into two shafts at the top) and pylons with their
stays (`pylons`): see `Bridge` in `src/world/dz.ts`. A `base`
on a bridge names it (`bridge`, an index), the station along it and the side:
the exit is then on the lip of the deck, outside the parapet, square to the
road, with no run-up, and its height is the road's above the landing field.

`imagery` names the orthophotos (`ign`, `pnoa`, `swissimage`, `dgu` or `pat`), and
`overpass` may name servers to ask first, such as a national mirror.

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
- Fine relief, France: RGE ALTI, IGN, Géoplateforme altimetry service,
  Licence Ouverte / Etalab 2.0.
- Orthophotos, Spain: PNOA, © Instituto Geográfico Nacional de España,
  CC BY 4.0 (scne.es).
- Orthophotos and fine relief, Switzerland: SWISSIMAGE and swissALTI3D,
  © swisstopo, free geodata (OGD), attribution required.
- Orthophotos, Croatia: DOF5 2019/20 (Istria flown in 2020), © Državna
  geodetska uprava, through its INSPIRE WMS (geoportal.dgu.hr), under the
  Croatian open licence, Otvorena dozvola (data.gov.hr/otvorena-dozvola: use
  of any kind, the source and its date to be named, like CC BY). The DGU's
  later orthophotos carry a watermark for anonymous users and its relief
  (DMR) is for registered or paying ones: Croatia's relief is the terrain
  tiles'.
- Orthophotos and fine relief, Trentino: the 2015 orthophoto (20 cm, through
  the SIAT's WMS) and the LiDAR DTM of the 2006-2009 flights (1 m GeoTIFFs,
  siatservices.provincia.tn.it, tiles found through the SIAT's WFS index),
  © Provincia autonoma di Trento, CC BY 4.0 (dati.trentino.it).
- Satellite, everywhere: Sentinel-2 cloudless 2023 by EOX IT Services GmbH
  (contains modified Copernicus Sentinel data 2023), CC BY-NC-SA 4.0: fine for
  this non-commercial project, the attribution must stay.
- Relief: Mapzen / AWS Terrain Tiles (SRTM, EU-DEM, GMTED, ETOPO1 and
  others), see their attribution list.
- Map data: © OpenStreetMap contributors, ODbL.
