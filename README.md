# OttTuber

A lightweight VRM 1.x avatar renderer with real-time face tracking for streaming. Designed as a modern replacement for VSeeFace that supports VRM 1.x avatars, uses MediaPipe for webcam-based face tracking, and outputs to a transparent Electron window that OBS can capture directly.

## Features

- **Real-time face tracking** — 52 ARKit blendshapes mapped to your avatar's expressions
- **Responsive head rotation** — tracks pitch, yaw, and roll from face landmarks
- **One-euro smoothing** — configurable per-expression filtering to reduce jitter
- **Transparent window** — frameless, transparent background for easy OBS integration
- **Config-driven** — adjust camera, tracking smoothing, and avatar parameters via `config.json` without rebuilding
- **Debug window** — live readout of every MediaPipe value with animated bars so you can see exactly what the tracker is doing

## Requirements

- **Node.js** 16+ (tested on v24.7.0)
- **Windows 11** (may work on other platforms — untested)
- **Webcam**
- **Internet access** (MediaPipe WASM loaded from CDN at startup)
- **VRM 1.x avatar file** (place in `VRMs/` folder)

## Quick Start

```bash
npm install
npm run build
npm start
```

The Electron window will launch frameless and transparent on your desktop. It won't appear in the taskbar — use **Alt+Tab** to find it or look for it directly on the desktop.

## Configuration

Edit `config.json` to tune tracking and appearance:

```json
{
  "camera": {
    "position": [0, 0.75, 1.1],
    "lookAt": [0, 0.70, 0],
    "fov": 35
  },
  "webcam": {
    "deviceLabel": null,
    "deviceId": null
  },
  "model": {
    "path": "VRMs/your-avatar.vrm",
    "scale": 1.0,
    "rotation": [0, 180, 0],
    "mirror": true,
  },
  "tracking": {
    "blendshapeAmplify": {
      "eyeBlinkLeft": 2.0,
      "eyeBlinkRight": 2.0
    },
    "blendshapeFilter": {
      "minCutoff": 1.0,
      "beta": 0.007
    },
    "blendshapeFilterOverrides": {
      "eyeBlinkLeft": { "minCutoff": 10.0, "beta": 0.5 },
      "eyeBlinkRight": { "minCutoff": 10.0, "beta": 0.5 }
    },
    "headFilter": {
      "minCutoff": 1.5,
      "beta": 0.1
    }
  }
}
```

### Key Settings

- **`model.path`** — relative path to your VRM file (e.g., `VRMs/my-avatar.vrm`)
- **`model.rotation`** — Euler angles in degrees to orient the avatar (default `[0, 180, 0]` faces camera)
- **`model.mirror`** — set to `true` to mirror the avatar (set by negating the X scale of the model)
- **`blendshapeAmplify`** — amplify specific expressions (blinks default to 2.0 because MediaPipe tends to underscore them)
- **`blendshapeFilter.minCutoff`** — lower = more smoothing (1.0 Hz is gentle; increase for less smoothing)
- **`blendshapeFilter.beta`** — adaptive smoothing factor (higher = more responsive to fast movements)
- **`webcam.deviceLabel`** — name of the camera as your OS exposes it (e.g. `"Logitech BRIO"`); matched via `enumerateDevices()` at startup. Preferred over `deviceId`.
- **`webcam.deviceId`** — raw browser device ID; use this if label matching doesn't work. Leave both `null` to use the system default camera.
- **`blendshapeFilterOverrides`** — per-expression filter settings (eyes use higher minCutoff for snappier blinks)

Rebuild not required — just save `config.json` and restart the app.

## Debug Window

A debug window opens automatically alongside the avatar window. It shows every value MediaPipe is producing in real time:

- **Head rotation** — pitch, yaw, and roll in degrees, displayed as an orange bar centred at 0° so you can see the direction at a glance
- **Blendshapes** — all 52 ARKit scores (or the standard VRM mapped values), 0–1, shown as a blue fill bar with the numeric value alongside

A small status badge in the header switches between **tracking** (green) and **no face** (grey) depending on whether the landmarker is picking up a face.

Close the window whenever you don't need it. Press **Ctrl+Shift+D** to bring it back.

## Architecture

```
Webcam → MediaPipe Face Landmarker (52 blendshapes + head pose)
         ↓
    One-euro filters (per-expression smoothing)
         ↓
    VRM Expression Manager (ARKit → custom expressions)
         ↓
    three.js renderer (transparent Electron window)
         ↓
    OBS capture (window or game capture)
```

## Dev Workflow

```bash
npm run dev    # build, watch, and launch (hot reload for renderer)
npm run build  # production build to out/
npm start      # launch the already-built app
```

**Note:** Main process HMR requires manual restart. Renderer HMR works automatically via Vite.

## Current Status

**M2 Complete** — Full 52 blendshape tracking, one-euro smoothing, and head rotation.

**M3 (upcoming)** — Hand tracking from MediaPipe Hand Landmarker.

**M4 (planned)** — Settings UI, webcam selection, persisted profiles.

## Contributing

OttTuber is pre-beta and under active development — many things are incomplete or rough by design. Bug reports and feature requests are welcome, but please check the milestone list above before reporting something as broken; it may already be known and planned.

**Code contributions are very welcome.** If you want to pick something up, open an issue or comment on an existing one so we can coordinate. PRs against `main` are fine for small fixes; for larger changes it's worth a quick discussion first.

## Known Limitations

- Hand tracking not yet implemented (M3)
- MediaPipe WASM requires internet access at startup (loads from jsDelivr CDN)
- Main process file changes require manual app restart (dev mode only)
- Untested on macOS and Linux (Windows-first)

## Troubleshooting

### Avatar doesn't appear
- Check that the VRM file path in `config.json` is correct
- Verify the file exists in the working directory
- Check the browser console (DevTools: Ctrl+Shift+I)

### Blinking doesn't work
- Increase `blendshapeAmplify.eyeBlinkLeft/Right` (try 2.5–3.0)
- Check that your avatar has ARKit blendshapes (many VRM 1.x avatars do)
- If using a standard VRM (no custom ARKit expressions), the fallback maps `aa` → `jawOpen`

### Avatar faces the wrong direction
- Adjust `model.rotation.y` in `config.json` (180° is typical, try 0° or 360°)

### Wrong camera is being used / want to select a specific webcam

The `webcam.deviceLabel` config field lets you target a specific camera by name. To find the right name:

1. Temporarily enable DevTools by adding `win.webContents.openDevTools()` to `createWindow()` in `src/main/index.ts`, then run `npm run build && npm start`
2. In the DevTools **Console** tab, run:
   ```js
   navigator.mediaDevices.enumerateDevices().then(d => console.table(d.filter(x => x.kind === 'videoinput')))
   ```
3. Find your camera in the table. Copy its **label** into `config.json`:
   ```json
   "webcam": { "deviceLabel": "Logitech BRIO", "deviceId": null }
   ```
4. Remove the `openDevTools()` line and rebuild.

Alternatively, copy the **deviceId** into `webcam.deviceId` instead — useful if two devices share the same label. Note that device IDs can change across OS reinstalls or USB reconnects, so label matching is more reliable long-term.

### Tracking feels laggy
- Increase `blendshapeFilter.minCutoff` and `headFilter.minCutoff` (higher = less smoothing)
- Lower `beta` values (less responsive to velocity, more consistent)

## Stack

- **Electron 33** — transparent frameless window
- **Vite 7** — build tool (via electron-vite 4)
- **three.js r170** — 3D rendering
- **@pixiv/three-vrm 3.x** — VRM 1.x support
- **@mediapipe/tasks-vision** — face/hand tracking

## License

Personal project for streaming. Feel free to fork and adapt for your own use.

## Credits

- **MediaPipe** — open-source ML framework by Google
- **three-vrm** — VRM rendering library by Pixiv
- **VSeeFace** — inspiration for the tracker concept
