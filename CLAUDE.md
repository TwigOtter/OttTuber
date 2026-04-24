# OttTuber — Claude context

VRM 1.x avatar renderer for streaming. Electron window (transparent, frameless) + three-vrm + MediaPipe face/hand tracking. Replaces VSeeFace for VRM 1.x users.

See DESIGN.md for full architecture and milestone definitions.

## Stack

- Electron 33 + electron-vite 4 + Vite 7
- TypeScript throughout
- three.js r170 + @pixiv/three-vrm 3.x (rendering)
- @mediapipe/tasks-vision (face/hand tracking, loaded from CDN at runtime)

## Current milestone

**M2 complete** (2026-04-24): Full 52 blendshapes + one-euro smoothing + head rotation. Face is expressively mirroring the user. Config-driven setup. See DESIGN.md §7 for M3–M5.

## Dev workflow

All npm scripts route through `scripts/evite.js` which clears `ELECTRON_RUN_AS_NODE`
before calling electron-vite. This is required because Claude Code is itself an Electron
app and sets that env var, which would otherwise make Electron skip its initialization
and break the entire API.

```
npm run dev    # build + watch + launch (hot reload for renderer)
npm run build  # production build to out/
npm start      # launch the already-built app
```

The Electron window is frameless and transparent — it won't appear in the taskbar as a
normal window. Use Alt+Tab or look for it on the desktop.

## Source layout

```
src/
  main/index.ts      — Electron main process: transparent BrowserWindow, webcam
                       permissions, VRM file IPC handler
  preload/index.ts   — exposes window.electron.loadVrm() to renderer
  renderer/
    index.html       — transparent body, loads main.ts as ES module
    src/
      main.ts        — three.js scene, VRM loader, MediaPipe loop
      env.d.ts       — TypeScript types for window.electron
scripts/
  evite.js           — electron-vite wrapper (clears ELECTRON_RUN_AS_NODE)
VRMs/                — avatar files (gitignored, not committed)
```

## Avatar notes

Test avatar: `Twig-dotter-ARKit.vrm` (0.86 m tall otter).

- Has all 52 ARKit blendshapes as direct custom expressions — no lookup table needed
- Needs `vrm.scene.rotation.y = Math.PI` to face the camera
- Camera framing for this avatar: `position(0, 0.75, 0.8)`, `lookAt(0, 0.65, 0)`, FOV 35

## Known issues / watch-outs

- `npm run dev` watch/HMR for the **main process** requires restarting the app manually
  (renderer HMR works fine via Vite)
- MediaPipe WASM is fetched from CDN (jsDelivr) at startup — requires internet access
- `webSecurity: false` is set on the BrowserWindow so the renderer can fetch CDN assets
  and load local VRM files; this is intentional for a local-only app
- The `electron` npm package correctly installs in node_modules but its `index.js` just
  returns the binary path — `require('electron')` only returns the real API when running
  _inside_ Electron with ELECTRON_RUN_AS_NODE unset
