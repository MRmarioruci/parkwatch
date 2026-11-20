# ParkWatch

Point an old Android phone at the street, mark the blue-zone parking spaces you care about, and get a push notification on your own phone when one is free.

- **Draw spots on the live camera.** Tap the corners of each space; save; repeat.
- **On-device detection.** Every few seconds the app takes a silent still, crops it to your spots and runs EfficientDet-Lite2 (COCO, TensorFlow Lite) to find cars, vans, buses and motorbikes. A spot is *taken* when vehicles cover more than a set share of it, confirmed over several checks so passing traffic doesn't count.
- **Appearance memory.** Detectors lose cars behind branches. Each spot also remembers how it looked when last known taken or free (a small grayscale patch compared by normalised cross-correlation, so clouds and dusk don't matter). A taken spot stays taken until it actually looks different; a free spot that suddenly looks very different counts as taken even if no car is detected. If a spot is wrong, tap **It's taken** / **It's free** and that view becomes its reference.
- **Alerts via [ntfy](https://ntfy.sh).** Install the ntfy app on the phone you carry, subscribe to a hard-to-guess topic, and enter the same topic in ParkWatch → Settings.
- **Private by design.** Stills are analysed and deleted straight away. Nothing is recorded or uploaded; only the alert text leaves the phone. Note that in Switzerland private cameras generally may not monitor public ground (see the EDÖB's guidance), so keep it this way.

## Install

Every push to `main` builds an APK and publishes it under **Releases**. Open the latest release on the Android phone, download `parkwatch-<version>.apk` and open it (allow your browser to install unknown apps if asked). Bump `version` in `package.json` and `app.json` for a new release.

## Use

1. Mount the phone looking down at the street, plugged in.
2. Open ParkWatch → **Add spot** → tap the corners of a space → **Save spot**. Tap a spot's name to rename it.
3. **Test detection**: the blue corner brackets should sit on the parked cars.
4. Settings → set your ntfy topic → **Send test**.
5. **Start watching**, then the moon button to black the screen. Keep the app open; Android pauses the camera for apps in the background.

Tune in Settings: check interval, the coverage threshold (white tick on each spot's meter), how many checks confirm a change, detector confidence, cooldown and quiet hours.

## Develop

```bash
npm install
npm run check          # typecheck, lint, tests
npx expo run:android   # native modules (camera, TFLite) need a dev build, not Expo Go
```

Logic that decides free/taken lives in `src/lib/spots.ts` (unit-tested); the camera → crop → TFLite pipeline in `src/lib/detector.ts`; the watch loop and alerts in `src/lib/watcher.ts`.

The model is `assets/models/efficientdet_lite2.tflite` (TensorFlow Lite's `lite-model_efficientdet_lite2_detection_metadata_1`, Apache 2.0).
