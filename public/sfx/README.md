# Crash sounds

Optional. The crash sounds (body hitting the ground, bones cracking, cries,
the groan afterwards) are made up on the spot by `src/audio/sound.ts`. Drop
recordings here and list them in an `index.json` to use them instead:

```json
{
  "hit": ["thud1.mp3", "thud2.mp3"],
  "crack": ["crack1.mp3", "crack2.mp3"],
  "cry": ["aie.mp3", "ouch.mp3"],
  "groan": ["groan.mp3"]
}
```

Each time, one file of the kind is picked at random. A kind left out stays
made up. In a slow-motion replay the files are played slower and lower.
