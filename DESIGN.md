# OttTuber — Design Document

**Status:** Initial design, pre-implementation
**Author:** Twig
**Last updated:** 2026-04-21

---

## 1. Motivation

Existing VTuber tooling on Windows is fragmented and aging:

- **VSeeFace** is the de facto standard for VRM streaming, but:
    - Only supports VRM 0.9, not VRM 1.x — cuts off most modern avatars
    - Face tracking quality is behind the curve even with ARKit passthrough (FaceMotion3D)
    - Hand tracking requires a LeapMotion device (~$140 hardware dependency)
    - Closed-source and no longer under active development
- **VRChat's built-in desktop tracking** (webcam-based) now produces better face _and_ hand tracking than VSeeFace + ARKit, using only a 720p webcam. This proves the tech is ready.
- **Unity's offerings** in this space are toy demos, not standalone tools.

The opportunity: Google's **MediaPipe Face Landmarker** outputs 52 ARKit-compatible blendshape coefficients directly from a standard webcam. Combined with MediaPipe's hand tracking and modern VRM 1.x rendering via **three-vrm**, a lightweight standalone tracker is feasible as a personal project — and fills a real gap for streamers who've outgrown VSeeFace.

## 2. Goals and non-goals

### Goals

- Track face and hands from a standard webcam (no LeapMotion, no iPhone required)
- Render a user-supplied VRM 1.x avatar with expressions driven by live tracking
- Output the avatar over a transparent background, capturable by OBS
- Keep end-to-end latency low enough to feel responsive during streaming (<100ms target)
- Run on a single machine alongside OBS and a game without melting the GPU
- Keep the architecture simple enough to be maintainable solo

### Non-goals (for v1)

- Full-body tracking (webcam pose estimation is noisy; revisit later)
- Physics simulation for hair/cloth/tails (three-vrm has `VRMSpringBone` for free but don't overinvest)
- Lip sync from audio (MediaPipe's mouth blendshapes from video should be sufficient)
- Avatar creation or editing tools
- Cross-platform at launch (Windows-first; macOS/Linux later if it matters)
- VRM 0.9 support — explicitly leaving that era behind
- iPhone/ARKit passthrough — the whole point is not needing it

### Explicit philosophical non-goals

- Not reinventing VSeeFace. This is a _replacement_ for VSeeFace for VRM 1.x users who want better tracking from a webcam. If a feature exists in VSeeFace and works fine, we don't need to match it.
- Not building a commercial product. This is for Twig's stream and whoever else wants it.

## 3. High-level architecture

```
┌─────────────┐
│  Webcam     │
└──────┬──────┘
       │ raw frames
       ▼
┌─────────────────────────────────────┐
│  Tracking worker (MediaPipe)        │
│  - Face Landmarker (blendshapes)    │
│  - Hand Landmarker (21 pts × 2)     │
└──────┬──────────────────────────────┘
       │ normalized tracking data (~30-60 Hz)
       ▼
┌─────────────────────────────────────┐
│  Smoothing + mapping layer          │
│  - One-euro filter on all channels  │
│  - ARKit → VRM 1.x expression map   │
│  - Landmark → bone rotation IK      │
└──────┬──────────────────────────────┘
       │ VRM expression weights + bone transforms
       ▼
┌─────────────────────────────────────┐
│  Renderer (three.js + three-vrm)    │
│  - Transparent background           │
│  - Alpha-channel window             │
└─────────────────────────────────────┘
       │
       ▼
   OBS capture (window or game capture)
```

### Why Electron + web stack

- **three-vrm** is the most mature VRM 1.x rendering library, JS-only
- **MediaPipe** has an excellent JS/WASM build with bundled models
- Electron supports **transparent windows** natively on Windows (OBS can capture the window directly, no chroma key needed)
- Single language across the stack = less glue code, faster iteration
- The alternative — Python with a C++ renderer — means gluing together MediaPipe Python, a VRM loader, and a GL context. Way more duct tape.

### Process model

Single Electron process to start. If MediaPipe inference on the main thread causes rendering jank (likely), move tracking to a **Web Worker** with `OffscreenCanvas` for the webcam feed. Keep the renderer on the main thread where it has GPU access.

## 4. Component design

### 4.1 Tracking worker

- **Input:** webcam stream via `getUserMedia`
- **Libraries:** `@mediapipe/tasks-vision` — provides both FaceLandmarker and HandLandmarker
- **Outputs per frame:**
    - 52 ARKit blendshape coefficients (0.0–1.0 each)
    - Head pose (rotation quaternion, derived from face landmarks)
    - 21 hand landmarks × 2 hands (3D positions in camera space)
    - Confidence scores per output
- **Target rate:** 30 Hz minimum, 60 Hz if hardware allows

### 4.2 Smoothing layer

Raw MediaPipe output is jittery. Use the **one-euro filter** — it's specifically designed for this, it's ~30 lines of code, and it handles the latency/smoothness tradeoff dynamically based on signal velocity.

Apply per-channel:

- Each blendshape coefficient: its own one-euro filter
- Head rotation: quaternion-space smoothing (SLERP toward filtered target)
- Hand landmarks: one-euro per landmark position

Configurable `minCutoff` and `beta` in settings — users will want to tune this for their own tracking noise floor.

### 4.3 Expression mapping (ARKit → VRM 1.x)

MediaPipe outputs the 52 ARKit blendshape names. VRM 1.x defines a standard expression set (happy, angry, sad, relaxed, surprised, neutral, aa/ih/ou/ee/oh, blink variants, lookUp/Down/Left/Right). These don't map 1:1.

**Strategy:**

1. **Direct pass-through** for avatars that expose ARKit blendshapes as custom expressions (many modern VRMs do — it's a convention). three-vrm supports custom expressions via `expressionManager.setValue(name, weight)`.
2. **Standard VRM expression blending** for avatars that only expose the VRM 1.x standard set. Use a lookup table that combines multiple ARKit blendshapes into each VRM expression. Example:
    - VRM `happy` ≈ weighted blend of ARKit `mouthSmileLeft`, `mouthSmileRight`, `cheekSquintLeft`, `cheekSquintRight`
    - VRM `aa` ≈ `jawOpen`
    - VRM `blinkLeft` ≈ `eyeBlinkLeft`
3. **Graceful fallback:** if neither set is available, log a warning and apply whatever does exist.

Detect which mode to use at avatar load by inspecting `vrm.expressionManager.expressions`.

### 4.4 Hand IK

MediaPipe gives 21 3D landmarks per hand. VRM rigs have a standard humanoid bone hierarchy. For v1:

- **Wrist position + rotation** from landmark 0 (wrist) and landmark 9 (middle finger MCP) to derive orientation
- **Per-finger joint rotations** derived from landmark-to-landmark vectors
- No elbow/shoulder IK yet — let the arms hang naturally or pin them to a neutral pose. Solving full-arm IK from wrist position alone is a known rabbit hole and not worth it for v1.

**Known risk:** MediaPipe hand depth is relative and noisy. Hands will likely "swim" in Z. Mitigate by clamping Z variance or locking hands to a plane in front of the avatar.

### 4.5 Renderer

- **three.js** scene with the VRM loaded via `@pixiv/three-vrm`
- Camera: fixed orthographic or perspective framing the avatar's upper body
- Lighting: simple ambient + directional, tunable in settings
- Background: `scene.background = null` + renderer `alpha: true` + `setClearColor(0x000000, 0)`
- **VRMLookAt** driven by MediaPipe's gaze data (or falling back to blendshape-based eye expressions)
- **VRMSpringBone** enabled for hair/accessories — it's already there, turn it on

### 4.6 Electron shell

- Transparent BrowserWindow (`transparent: true`, `frame: false`)
- Draggable by a small always-visible handle so the user can reposition
- Hotkey (Alt+H?) to toggle window visibility without killing tracking
- Settings panel in a separate window (avoids cluttering the transparent render surface)

## 5. Data model

### Avatar config (persisted per avatar)

```json
{
  "vrmPath": "C:/path/to/avatar.vrm",
  "expressionMode": "arkit" | "standard" | "auto",
  "expressionOverrides": {
    "happy": { "weight": 1.2, "sources": ["mouthSmileLeft", "mouthSmileRight"] }
  },
  "smoothingProfile": {
    "minCutoff": 1.0,
    "beta": 0.007
  },
  "cameraFraming": {
    "position": [0, 1.4, 1.2],
    "target": [0, 1.4, 0],
    "fov": 35
  }
}
```

### App settings (global)

- Selected webcam device
- Selected audio device (for future lip sync, placeholder now)
- Tracking toggles (face / hands independently)
- Window position + size
- Active avatar config

Both stored as JSON in Electron's `userData` directory.

## 6. Open questions

- **Does MediaPipe's JS build keep pace with the Python/C++ builds?** Worth verifying their blendshape output is identical across targets before committing. If JS lags, fall back to a Python sidecar communicating over WebSocket.
- **Hand tracking when hands are off-camera.** Hide the hands entirely? Freeze last pose? Lerp to a neutral rest pose? Latter feels best but adds complexity.
- **Avatar calibration.** Raw blendshape zero is not the user's neutral face. A "hold a neutral expression for 3 seconds" calibration step on startup would help a lot. Priority: v1 or v2?
- **Performance budget.** Target a single modern GPU running the tracker + renderer at 60Hz + a VRChat or similar game simultaneously. Need to profile early and often.
- **VSeeFace protocol compatibility.** VSeeFace has a UDP protocol some tools consume. Worth emitting for compatibility? Probably not for v1 — the whole point is to _not_ be VSeeFace.

## 7. Milestones

### M1: Dead-simple prototype

- Electron app with a transparent window
- MediaPipe face tracking running on the main thread
- A hardcoded VRM loads and its `jawOpen` expression follows the user's mouth
- _Success criteria:_ open your mouth, avatar opens its mouth. That's it.

### M2: Full face mapping

- All 52 blendshapes routed through the ARKit → VRM mapping layer
- One-euro smoothing in place
- Head rotation working
- _Success criteria:_ avatar's face is clearly expressive and recognizably mirroring the user

### M3: Hands

- Hand tracking active, wrist + fingers driven from MediaPipe
- _Success criteria:_ can wave at chat

### M4: Usable for an actual stream

- Settings UI for webcam selection, avatar loading, smoothing tuning
- Persisted config
- Tested under real streaming load alongside OBS + a game
- _Success criteria:_ can use it on a stream

### M5 (stretch): The nice-to-haves

- Calibration routine
- Hotkey support
- Multiple avatar profiles
- Performance profiling + optimization pass

## 8. Risks

- **MediaPipe JS quality may not match Python.** Mitigation: Python sidecar fallback is feasible if needed. Test early.
- **Electron memory footprint.** Streaming setups are already resource-tight. Mitigation: profile, strip unused Electron features, consider Tauri if Electron is genuinely too heavy.
- **Hand tracking usability.** Depth noise may make it worse than having no hands. Mitigation: make it toggle-able and ship without if needed.
- **Scope creep.** This kind of project is a notorious hyperfixation trap. Mitigation: M1 is deliberately tiny. Ship it before building M2.

## 9. Dependencies (working list)

- `electron`
- `three`
- `@pixiv/three-vrm`
- `@mediapipe/tasks-vision`
- Some kind of one-euro filter — small enough to vendor; no point pulling a package

That's the doc. It's a starting point, not scripture — expect to rewrite sections of this after M1 when reality has opinions.
