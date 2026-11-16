// Turns one tile's grid and picture into a .glb: the picture compressed for
// the graphics card (KTX2, Basis ETC1S, with its mipmaps), the grid quantized
// and compressed (meshopt). Run in worker threads by build.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { Document, Logger, NodeIO, TextureInfo } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptEncoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions([KHRTextureBasisu, KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function build(job) {
  const { file, texture, positions, normals, uvs, indices, translation, quality, trees } = job;
  const ktx2 = await encodeToKTX2(texture.data, {
    isUASTC: false,
    qualityLevel: quality,
    compressionLevel: 2,
    generateMipmap: true,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    isKTX2File: true,
    imageDecoder: async () => ({ data: texture.data, width: texture.size, height: texture.size }),
  });

  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const image = doc.createTexture('photo').setImage(new Uint8Array(ktx2)).setMimeType('image/ktx2');
  const material = doc.createMaterial('ground').setBaseColorTexture(image).setMetallicFactor(0).setRoughnessFactor(1);
  material
    .getBaseColorTextureInfo()
    .setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE)
    .setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE)
    .setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR)
    .setMagFilter(TextureInfo.MagFilter.LINEAR);
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', positions))
    .setAttribute('NORMAL', accessor('VEC3', normals))
    .setAttribute('TEXCOORD_0', accessor('VEC2', uvs))
    .setIndices(accessor('SCALAR', indices))
    .setMaterial(material);
  const mesh = doc.createMesh('ground').addPrimitive(primitive);
  // The square's trees, a point each: where, how tall and wide, which kind, its rank, the slope under it, its colour.
  if (trees) {
    const points = doc
      .createPrimitive()
      .setMode(0)
      .setAttribute('POSITION', accessor('VEC3', trees.positions))
      .setAttribute('COLOR_0', accessor('VEC4', trees.colors).setNormalized(true))
      .setAttribute('_SHAPE', accessor('VEC4', trees.shapes))
      .setAttribute('_SLOPE', accessor('VEC2', trees.slopes))
      .setMaterial(doc.createMaterial('trees'));
    mesh.addPrimitive(points);
  }
  const node = doc.createNode('ground').setMesh(mesh).setTranslation(translation);
  doc.createScene().addChild(node);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, glb);
  return { bytes: glb.byteLength, texture: ktx2.byteLength };
}

parentPort.on('message', async (job) => {
  try {
    parentPort.postMessage({ id: job.id, ...(await build(job)) });
  } catch (e) {
    parentPort.postMessage({ id: job.id, error: String(e?.stack ?? e) });
  }
});
