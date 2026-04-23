import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm'
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'

// ---------------------------------------------------------------------------
// One-euro filter (vendored)
// ---------------------------------------------------------------------------

class OneEuroFilter {
  private minCutoff: number
  private beta: number
  private dCutoff: number
  private x: number | null = null
  private dx = 0
  private t: number | null = null

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  private alpha(cutoff: number, dt: number): number {
    const r = 2 * Math.PI * cutoff * dt
    return r / (r + 1)
  }

  filter(value: number, timestamp: number): number {
    if (this.t === null) { this.t = timestamp; this.x = value; return value }
    const dt = Math.max((timestamp - this.t) / 1000, 1e-6)
    const d = (value - this.x!) / dt
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x = this.x! + this.alpha(cutoff, dt) * (value - this.x!)
    this.t = timestamp
    return this.x!
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
renderer.setClearColor(0x000000, 0)
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(0, 0.75, 1.1)
camera.lookAt(new THREE.Vector3(0, 0.60, 0))

scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const sun = new THREE.DirectionalLight(0xffffff, 0.8)
sun.position.set(1, 2, 3)
scene.add(sun)

// ---------------------------------------------------------------------------
// VRM load
// ---------------------------------------------------------------------------

// Fallback mapping for avatars that only expose standard VRM 1.x expressions.
// Each entry is [arkitBlendshapeName, weight]. Multiple sources are summed and clamped.
const STANDARD_VRM_MAP: Record<string, [string, number][]> = {
  blinkLeft:  [['eyeBlinkLeft', 1]],
  blinkRight: [['eyeBlinkRight', 1]],
  aa:         [['jawOpen', 1]],
  ih:         [['mouthClose', 0.6]],
  ou:         [['mouthPucker', 1]],
  ee:         [['mouthStretchLeft', 0.5], ['mouthStretchRight', 0.5]],
  oh:         [['jawOpen', 0.4], ['mouthFunnel', 0.6]],
  happy:      [['mouthSmileLeft', 0.5], ['mouthSmileRight', 0.5]],
  sad:        [['mouthFrownLeft', 0.5], ['mouthFrownRight', 0.5]],
  angry:      [['browDownLeft', 0.5], ['browDownRight', 0.5]],
  surprised:  [['browInnerUp', 0.6], ['eyeWideLeft', 0.2], ['eyeWideRight', 0.2]],
}

async function loadVrm(path: string): Promise<VRM> {
  const buffer = await window.electron.loadVrm(path)
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await new Promise<{ userData: { vrm: VRM } }>((resolve, reject) =>
    loader.parse(buffer, '', resolve as (gltf: unknown) => void, reject)
  )
  const vrm = gltf.userData.vrm
  console.log('VRM expressions:', vrm.expressionManager?.expressions.map((e) => e.expressionName))
  return vrm
}

// ---------------------------------------------------------------------------
// MediaPipe face landmarker
// ---------------------------------------------------------------------------

async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU'
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: 'VIDEO',
    numFaces: 1
  })
}

// ---------------------------------------------------------------------------
// Webcam
// ---------------------------------------------------------------------------

async function openWebcam(webcam: AppConfig['webcam']): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.style.display = 'none'
  document.body.appendChild(video)

  let videoConstraint: MediaTrackConstraints | boolean = true
  if (webcam?.deviceLabel) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const match = devices.find(d => d.kind === 'videoinput' && d.label === webcam.deviceLabel)
    if (match) videoConstraint = { deviceId: { exact: match.deviceId } }
  } else if (webcam?.deviceId) {
    videoConstraint = { deviceId: { exact: webcam.deviceId } }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint })
  video.srcObject = stream
  await video.play()
  return video
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AppConfig = {
  camera: { position: [0, 0.75, 1.1], lookAt: [0, 0.60, 0], fov: 35 },
  model: { path: 'VRMs/Twig-dotter-ARKit.vrm', scale: 1.0, rotation: [0, 180, 0] },
  tracking: {
    blendshapeAmplify: { eyeBlinkLeft: 2.0, eyeBlinkRight: 2.0 },
    blendshapeFilter: { minCutoff: 1.0, beta: 0.007 },
    blendshapeFilterOverrides: {
      eyeBlinkLeft:  { minCutoff: 10.0, beta: 0.5 },
      eyeBlinkRight: { minCutoff: 10.0, beta: 0.5 },
    },
    headFilter: { minCutoff: 1.5, beta: 0.1 },
  }
}

const RAD_TO_DEG = 180 / Math.PI

async function main(): Promise<void> {
  // Config must resolve first — VRM path comes from it
  const config: AppConfig = (await window.electron.loadConfig()) ?? DEFAULT_CONFIG

  const [vrm, faceLandmarker, video] = await Promise.all([
    loadVrm(config.model.path),
    loadFaceLandmarker(),
    openWebcam(config.webcam)
  ])

  // Apply camera from config
  const [cx, cy, cz] = config.camera.position
  const [lx, ly, lz] = config.camera.lookAt
  camera.position.set(cx, cy, cz)
  camera.fov = config.camera.fov
  camera.updateProjectionMatrix()
  camera.lookAt(lx, ly, lz)

  // Apply model transform from config (rotation in degrees)
  const [rx, ry, rz] = config.model.rotation.map((d) => (d * Math.PI) / 180)
  vrm.scene.rotation.set(rx, ry, rz)
  vrm.scene.scale.setScalar(config.model.scale)
  scene.add(vrm.scene)

  // Mirror by negating the X scale. This is a simple way to mirror the avatar without needing to adjust the tracking data.
  if (config.model.mirror) {
    vrm.scene.scale.x *= -1
  }

  // ARKit avatars expose 'jawOpen' as a custom expression — direct pass-through.
  // Standard VRM avatars only have the built-in expression set — use the mapping table.
  const useARKit = vrm.expressionManager?.getValue('jawOpen') !== undefined

  const { minCutoff: bsMin, beta: bsBeta } = config.tracking.blendshapeFilter
  const bsOverrides = config.tracking.blendshapeFilterOverrides ?? {}
  const { minCutoff: hMin, beta: hBeta } = config.tracking.headFilter
  const bsFilters = new Map<string, OneEuroFilter>()
  const headFilters = [
    new OneEuroFilter(hMin, hBeta),
    new OneEuroFilter(hMin, hBeta),
    new OneEuroFilter(hMin, hBeta),
  ]

  const headBone = vrm.humanoid?.getNormalizedBoneNode('head')
  const mat4 = new THREE.Matrix4()
  const euler = new THREE.Euler()

  const clock = new THREE.Clock()
  let lastVideoTime = -1

  function animate(): void {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    const now = performance.now()

    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const result = faceLandmarker.detectForVideo(video, Date.now())

      const debugBlendshapes: DebugData['blendshapes'] = []
      let debugHead: DebugData['head'] = { pitch: 0, yaw: 0, roll: 0 }
      const detected = !!(result.faceBlendshapes?.[0] || result.facialTransformationMatrixes?.[0])

      // --- Blendshapes ---
      const shapes = result.faceBlendshapes?.[0]?.categories
      const em = vrm.expressionManager

      if (shapes && em) {
        if (useARKit) {
          for (const shape of shapes) {
            const name = shape.categoryName
            const amplify = config.tracking.blendshapeAmplify[name] ?? 1
            const raw = Math.min(1, shape.score * amplify)
            if (!bsFilters.has(name)) {
              const p = bsOverrides[name] ?? { minCutoff: bsMin, beta: bsBeta }
              bsFilters.set(name, new OneEuroFilter(p.minCutoff, p.beta))
            }
            const filtered = bsFilters.get(name)!.filter(raw, now)
            em.setValue(name, filtered)
            debugBlendshapes.push({ name, value: filtered })
          }
        } else {
          const scoreMap = new Map(shapes.map((s) => [s.categoryName, s.score]))
          for (const [vrmExpr, sources] of Object.entries(STANDARD_VRM_MAP)) {
            if (em.getValue(vrmExpr) === undefined) continue
            const raw = Math.min(1, sources.reduce((sum, [src, w]) => sum + (scoreMap.get(src) ?? 0) * w, 0))
            if (!bsFilters.has(vrmExpr)) bsFilters.set(vrmExpr, new OneEuroFilter(bsMin, bsBeta))
            const filtered = bsFilters.get(vrmExpr)!.filter(raw, now)
            em.setValue(vrmExpr, filtered)
            debugBlendshapes.push({ name: vrmExpr, value: filtered })
          }
        }
        em.update()
      }

      // --- Head rotation ---
      const txMatrix = result.facialTransformationMatrixes?.[0]
      if (txMatrix && headBone) {
        // MediaPipe outputs a column-major 4x4 matrix (OpenGL convention) in camera space.
        // Negate X and Y to match VRM coordinate system with avatar facing the camera.
        // If any axis feels inverted when testing, flip its sign here.
        mat4.fromArray(txMatrix.data)
        euler.setFromRotationMatrix(mat4, 'YXZ')
        const hx = headFilters[0].filter(-euler.x, now)
        const hy = headFilters[1].filter( euler.y, now)
        const hz = headFilters[2].filter(-euler.z, now)
        headBone.quaternion.setFromEuler(new THREE.Euler(hx, hy, hz, 'YXZ'))
        debugHead = {
          pitch: hx * RAD_TO_DEG,
          yaw:   hy * RAD_TO_DEG,
          roll:  hz * RAD_TO_DEG,
        }
      }

      window.electron.sendDebugData({ detected, blendshapes: debugBlendshapes, head: debugHead })
    }

    vrm.update(delta)
    renderer.render(scene, camera)
  }

  animate()
}

main().catch(console.error)
