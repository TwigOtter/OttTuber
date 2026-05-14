# OttTuber

A lightweight VRM 1.x avatar renderer with real-time face and body tracking for streaming. Designed as a modern replacement for VSeeFace that supports VRM 1.x avatars, uses MediaPipe for webcam-based tracking, and outputs to a transparent Electron window that OBS can capture directly.

## Features

- **Real-time face tracking** — 52 ARKit blendshapes mapped to your avatar's expressions
- **Head rotation** — tracks pitch, yaw, and roll from face landmarks
- **Arm & hand tracking** — upper/lower arm bones and full 16-joint finger chains driven from MediaPipe pose and hand landmarkers
- **Audio-driven mouth** — mic amplitude dynamically loosens mouth-filter smoothing when you talk, and boosts mouth scores so your avatar's lips move more expressively at small scale
- **One-euro smoothing** — configurable per-expression filtering to reduce jitter, with per-axis overrides for eyes and hands
- **Transparent window** — frameless, transparent background for easy OBS integration
- **Config-driven** — adjust camera, tracking, and avatar parameters via `config.json` without rebuilding
- **Debug window** — live readout of every tracked value with animated bars (Ctrl+Shift+D to toggle)

## Requirements

- **Node.js** 16+ (tested on v24.7.0)
- **Windows 11** (may work on other platforms — untested)
- **Webcam** and **microphone**
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

Edit `config.json` to tune tracking and appearance. All fields except `model.path` are optional and fall back to sensible defaults.

```json
{
    "camera": {
        "position": [0, 0.75, 1.1],
        "lookAt": [0, 0.7, 0],
        "fov": 35
    },
    "webcam": {
        "deviceLabel": null,
        "deviceId": null
    },
    "audio": {
        "enabled": true,
        "deviceId": null
    },
    "model": {
        "path": "VRMs/your-avatar.vrm",
        "scale": 1.0,
        "rotation": [0, 180, 0],
        "mirror": false
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
            "eyeBlinkLeft":  { "minCutoff": 10.0, "beta": 0.5 },
            "eyeBlinkRight": { "minCutoff": 10.0, "beta": 0.5 }
        },
        "headFilter": {
            "minCutoff": 1.5,
            "beta": 0.1
        },
        "armCalibration": {
            "minCutoff": 1.0,
            "beta": 0.01
        },
        "handFilter": {
            "minCutoff": 4.0,
            "beta": 0.5
        },
        "mouthFilter": {
            "noiseFloor": 0.01,
            "minCutoffSilent": 1.0,
            "minCutoffTalking": 8.0,
            "amplitudeScale": 10
        }
    }
}
```

### Key Settings

**Model**
- **`model.path`** — relative path to your VRM file (e.g., `VRMs/my-avatar.vrm`)
- **`model.rotation`** — Euler angles in degrees to orient the avatar (`[0, 180, 0]` faces camera)
- **`model.mirror`** — mirrors the avatar by negating the X scale

**Blendshapes / face**
- **`blendshapeAmplify`** — amplify specific expressions (blinks default to 2× because MediaPipe tends to underscore them)
- **`blendshapeFilter.minCutoff`** — base smoothing for all expressions (lower = smoother, 1.0 Hz is gentle)
- **`blendshapeFilter.beta`** — adaptive factor (higher = more responsive to fast motion)
- **`blendshapeFilterOverrides`** — per-expression overrides (eyes use higher minCutoff for snappy blinks)

**Mouth / audio**
- **`mouthFilter.amplitudeScale`** — how much mic amplitude boosts raw mouth scores (`value *= 1 + amplitude * scale`). Increase if your model shows little lip movement at normal speaking volume. Default `10`.
- **`mouthFilter.minCutoffTalking`** — filter cutoff when you're speaking loudly (higher = more responsive). Default `8.0`.
- **`mouthFilter.minCutoffSilent`** — filter cutoff when silent (defaults to `blendshapeFilter.minCutoff`).
- **`mouthFilter.noiseFloor`** — RMS amplitude below which the mic is treated as silent. Default `0.01`.

**Arms & hands**
- **`armCalibration.minCutoff` / `beta`** — one-euro filter parameters for arm bones
- **`handFilter.minCutoff` / `beta`** — one-euro filter parameters for finger joints (higher minCutoff = more responsive, less smooth)

**Webcam**
- **`webcam.deviceLabel`** — camera name as your OS exposes it (e.g., `"Logitech BRIO"`). Preferred over `deviceId`.
- **`webcam.deviceId`** — raw browser device ID, useful if two cameras share a label.

Rebuild not required — save `config.json` and restart the app.

## Debug Window

A debug window opens automatically alongside the avatar window. Press **Ctrl+Shift+D** to toggle it.

The window shows every tracked value in real time:

- **Audio** — mic amplitude and mouth drive (0–1 scale showing how much the mouth filter is being loosened)
- **Head rotation** — pitch, yaw, roll in degrees (orange bars centred at 0°)
- **Arms** — upper and lower arm direction vectors
- **Blendshapes** — all expression values 0–1 (blue bars)

Use the **mouth drive** bar to tune `mouthFilter.noiseFloor`: if it jumps when you're silent, raise the threshold; if it doesn't reach 1 when you're clearly talking, lower it.

## Architecture

```
Webcam ──┬──► MediaPipe Face Landmarker (52 blendshapes + head matrix)
         │         ↓
         │    One-euro filters (per-expression, dynamically loosened by mic)
         │         ↓
         │    VRM Expression Manager → three.js renderer
         │
         ├──► MediaPipe Pose Landmarker (shoulder/elbow/wrist world landmarks)
         │         ↓
         │    One-euro filters → arm bone quaternions (setFromUnitVectors)
         │
         └──► MediaPipe Hand Landmarker (21 landmarks × 2 hands)
                   ↓
              One-euro filters → wrist + 15 finger bone quaternions
                   (roll split between lower arm and wrist for natural twist)

Mic ────────► RMS amplitude → loosens mouth filter + boosts mouth scores
```

**Source layout**

```
src/
  main/index.ts          — Electron main: transparent BrowserWindow, IPC handlers
  preload/index.ts       — exposes window.electron API to renderer
  renderer/
    index.html / debug.html
    src/
      main.ts            — scene, config, main loop
      audio.ts           — mic open + RMS amplitude
      one-euro-filter.ts — adaptive low-pass filter
      landmarkers.ts     — MediaPipe landmarker loaders
      loaders.ts         — VRM loader + webcam open
      hand-pose.ts       — wrist + finger bone solver
      debug.ts           — debug overlay UI
      env.d.ts           — AppConfig / DebugData / window.electron types
```

## Dev Workflow

```bash
npm run dev    # build, watch, and launch (hot reload for renderer)
npm run build  # production build to out/
npm start      # launch the already-built app
```

**Note:** Main process changes require a manual restart. Renderer HMR works automatically via Vite.

## Current Status

**M3 in progress** — Arm tracking and hand/finger tracking are implemented. Audio-driven mouth responsiveness added.

**M4 (planned)** — Settings UI, webcam/mic selection, persisted profiles.

## Contributing

OttTuber is pre-beta and under active development — many things are incomplete or rough by design. Bug reports and feature requests are welcome.

**Code contributions are very welcome.** If you want to pick something up, open an issue or comment on an existing one so we can coordinate. PRs against `main` are fine for small fixes; for larger changes it's worth a quick discussion first.

## Known Limitations

- `main.ts` renderer entry point is slightly over the 500-line target — pending a follow-up split in M4
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

### Avatar's mouth barely moves when talking

- Increase `mouthFilter.amplitudeScale` (try 15–20)
- Check the **mouth drive** bar in the debug window — if it's near 0 while you're speaking, lower `mouthFilter.noiseFloor`
- Make sure your microphone is enabled and selected (check `audio.deviceId` in config)

### Avatar faces the wrong direction

- Adjust `model.rotation` in `config.json` (y: 180° is typical for most avatars)

### Wrong camera selected

The `webcam.deviceLabel` config field lets you target a specific camera by name. To find the right name:

1. Temporarily enable DevTools by adding `win.webContents.openDevTools()` to `createWindow()` in `src/main/index.ts`, then run `npm run build && npm start`
2. In the DevTools **Console** tab, run:
    ```js
    navigator.mediaDevices
        .enumerateDevices()
        .then((d) => console.table(d.filter((x) => x.kind === "videoinput")));
    ```
3. Copy the camera's **label** into `config.json` and remove the `openDevTools()` line.

### Tracking feels laggy

- Increase `blendshapeFilter.minCutoff` and `headFilter.minCutoff` (higher = less smoothing)
- Lower `beta` values for more consistent (less velocity-responsive) smoothing

## Stack

- **Electron 33** — transparent frameless window
- **Vite 7** — build tool (via electron-vite 4)
- **three.js r170** — 3D rendering
- **@pixiv/three-vrm 3.x** — VRM 1.x support
- **@mediapipe/tasks-vision** — face, pose, and hand tracking

## License

Personal project for streaming. Feel free to fork and adapt for your own use.

## Credits

- **MediaPipe** — open-source ML framework by Google
- **three-vrm** — VRM rendering library by Pixiv
- **VSeeFace** — inspiration for the tracker concept
