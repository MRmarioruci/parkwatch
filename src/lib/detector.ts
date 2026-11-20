// On-device vehicle detection: a still from the camera, cropped to the spots, cut to the
// model's 448×448 input in overlapping square tiles, decoded to RGB bytes and run through
// EfficientDet-Lite2 (COCO, TFLite).
// The same pixels give each spot's appearance patch. Every intermediate file is deleted
// straight away; nothing leaves the phone.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

import { extractPatch, mergeBoxes, parseDetections, tilesFor, type Box, type Patch, type Rect, type Spot } from './spots';

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

export type Look = { boxes: Box[]; patches: Record<string, Patch | null>; tiles: number };

type PxRect = { originX: number; originY: number; width: number; height: number };

/** Crop a pixel rect out of the photo, scale it to SIZE×SIZE and decode it to RGB bytes. */
async function rgbOf(photo: Photo, crop: PxRect, temp: string[]): Promise<Uint8Array> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  ctx.crop(crop);
  ctx.resize({ width: SIZE, height: SIZE });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  temp.push(out.uri);
  const raw = jpeg.decode(await new File(out.uri).bytes(), { useTArray: true, formatAsRGBA: false });
  if (raw.width !== SIZE || raw.height !== SIZE) throw new Error(`Unexpected frame size ${raw.width}×${raw.height}`);
  return raw.data;
}

function clampCrop(photo: Photo, c: PxRect): PxRect {
  const originX = Math.max(0, Math.min(photo.width - 1, Math.floor(c.originX)));
  const originY = Math.max(0, Math.min(photo.height - 1, Math.floor(c.originY)));
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(Math.floor(c.width), photo.width - originX)),
    height: Math.max(1, Math.min(Math.floor(c.height), photo.height - originY)),
  };
}

const norm = (photo: Photo, c: PxRect): Rect => ({ x: c.originX / photo.width, y: c.originY / photo.height, w: c.width / photo.width, h: c.height / photo.height });

export async function detectVehicles(photo: Photo, roi: Rect, minScore: number, spots: Spot[]): Promise<Look> {
  const m = await loadDetector();
  const temp: string[] = [];
  try {
    const roiPx = clampCrop(photo, { originX: roi.x * photo.width, originY: roi.y * photo.height, width: roi.w * photo.width, height: roi.h * photo.height });

    // Appearance patches come from one view of the whole region (no model run needed).
    const whole = await rgbOf(photo, roiPx, temp);
    const wholeRect = norm(photo, roiPx);
    const patches = Object.fromEntries(spots.map((sp) => [sp.id, extractPatch(whole, SIZE, wholeRect, sp.pts)]));

    // Detection runs on square tiles so cars keep their shape and get more pixels.
    const tiles = tilesFor({ x: roiPx.originX, y: roiPx.originY, w: roiPx.width, h: roiPx.height });
    const found: Box[] = [];
    for (const t of tiles) {
      const crop = clampCrop(photo, { originX: t.x, originY: t.y, width: t.w, height: t.h });
      const rgb = await rgbOf(photo, crop, temp);
      const input = rgb.buffer.slice(rgb.byteOffset, rgb.byteOffset + rgb.byteLength) as ArrayBuffer;
      // EfficientDet-Lite outputs: boxes [ymin, xmin, ymax, xmax], classes, scores, count.
      const [boxes, classes, scores, count] = await m.run([input]);
      found.push(
        ...parseDetections(
          {
            boxes: new Float32Array(boxes),
            classes: new Float32Array(classes),
            scores: new Float32Array(scores),
            count: new Float32Array(count)[0] ?? 0,
          },
          norm(photo, crop),
          minScore,
        ),
      );
    }
    return { boxes: mergeBoxes(found), patches, tiles: tiles.length };
  } finally {
    remove(photo.uri);
    temp.forEach(remove);
  }
}
