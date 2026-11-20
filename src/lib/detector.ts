// On-device vehicle detection: a still from the camera, cropped to the spots, shrunk to the
// model's 448×448 input, decoded to RGB bytes and run through EfficientDet-Lite2 (COCO, TFLite).
// The same pixels give each spot's appearance patch. Every intermediate file is deleted
// straight away; nothing leaves the phone.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

import { extractPatch, parseDetections, type Box, type Patch, type Rect, type Spot } from './spots';

const SIZE = 448;

let model: Promise<TfliteModel> | null = null;

export function loadDetector(): Promise<TfliteModel> {
  if (!model) {
    model = (async () => {
      // In a release build the bundled model is an Android resource name, not a URL, which the
      // TFLite loader can't open. expo-asset copies it to a local file first; use that path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles the model asset
      const asset = await Asset.fromModule(require('../../assets/models/efficientdet_lite2.tflite')).downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      return loadTensorflowModel({ url: uri.includes('://') ? uri : `file://${uri}` }, []);
    })().catch((e) => {
      model = null; // allow a retry
      throw e;
    });
  }
  return model;
}

function remove(uri: string | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

export type Photo = { uri: string; width: number; height: number };

export type Look = { boxes: Box[]; patches: Record<string, Patch | null> };

export async function detectVehicles(photo: Photo, roi: Rect, minScore: number, spots: Spot[]): Promise<Look> {
  const m = await loadDetector();
  let small: string | undefined;
  try {
    const crop = {
      originX: Math.floor(roi.x * photo.width),
      originY: Math.floor(roi.y * photo.height),
      width: Math.max(1, Math.floor(roi.w * photo.width)),
      height: Math.max(1, Math.floor(roi.h * photo.height)),
    };
    crop.width = Math.min(crop.width, photo.width - crop.originX);
    crop.height = Math.min(crop.height, photo.height - crop.originY);
    // The crop actually used, back in normalised coordinates, so boxes map exactly.
    const used: Rect = { x: crop.originX / photo.width, y: crop.originY / photo.height, w: crop.width / photo.width, h: crop.height / photo.height };

    const ctx = ImageManipulator.manipulate(photo.uri);
    ctx.crop(crop);
    ctx.resize({ width: SIZE, height: SIZE });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
    small = out.uri;

    const bytes = await new File(out.uri).bytes();
    const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false });
    if (raw.width !== SIZE || raw.height !== SIZE) throw new Error(`Unexpected frame size ${raw.width}×${raw.height}`);
    const input = raw.data.buffer.slice(raw.data.byteOffset, raw.data.byteOffset + raw.data.byteLength) as ArrayBuffer;

    const patches = Object.fromEntries(spots.map((sp) => [sp.id, extractPatch(raw.data, SIZE, used, sp.pts)]));

    // EfficientDet-Lite outputs: boxes [ymin, xmin, ymax, xmax], classes, scores, count.
    const [boxes, classes, scores, count] = await m.run([input]);
    const found = parseDetections(
      {
        boxes: new Float32Array(boxes),
        classes: new Float32Array(classes),
        scores: new Float32Array(scores),
        count: new Float32Array(count)[0] ?? 0,
      },
      used,
      minScore,
    );
    return { boxes: found, patches };
  } finally {
    remove(photo.uri);
    remove(small);
  }
}
