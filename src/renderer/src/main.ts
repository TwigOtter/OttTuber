import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMHumanBoneName } from '@pixiv/three-vrm'
import { FilesetResolver, FaceLandmarker, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'

// ---------------------------------------------------------------------------
// One-euro filter (vendored)
// ---------------------------------------------------------------------------

class OneEuroFilter {
	private minCutoff: number;
	private beta: number;
	private dCutoff: number;
	private x: number | null = null;
	private dx = 0;
	private t: number | null = null;

	constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
		this.minCutoff = minCutoff;
		this.beta = beta;
		this.dCutoff = dCutoff;
	}

	private alpha(cutoff: number, dt: number): number {
		const r = 2 * Math.PI * cutoff * dt;
		return r / (r + 1);
	}

	filter(value: number, timestamp: number): number {
		if (this.t === null) {
			this.t = timestamp;
			this.x = value;
			return value;
		}
		const dt = Math.max((timestamp - this.t) / 1000, 1e-6);
		const d = (value - this.x!) / dt;
		this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
		const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
		this.x = this.x! + this.alpha(cutoff, dt) * (value - this.x!);
		this.t = timestamp;
		return this.x!;
	}
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
	35,
	window.innerWidth / window.innerHeight,
	0.1,
	100,
);
camera.position.set(0, 0.75, 1.1);
camera.lookAt(new THREE.Vector3(0, 0.6, 0));

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(1, 2, 3);
scene.add(sun);

// ---------------------------------------------------------------------------
// VRM load
// ---------------------------------------------------------------------------

// Fallback mapping for avatars that only expose standard VRM 1.x expressions.
// Each entry is [arkitBlendshapeName, weight]. Multiple sources are summed and clamped.
const STANDARD_VRM_MAP: Record<string, [string, number][]> = {
  blinkLeft: [['eyeBlinkLeft', 1]],
  blinkRight: [['eyeBlinkRight', 1]],
  aa: [['jawOpen', 1]],
  ih: [['mouthClose', 0.6]],
  ou: [['mouthPucker', 1]],
  ee: [['mouthStretchLeft', 0.5], ['mouthStretchRight', 0.5]],
  oh: [['jawOpen', 0.4], ['mouthFunnel', 0.6]],
  happy: [['mouthSmileLeft', 0.5], ['mouthSmileRight', 0.5]],
  sad: [['mouthFrownLeft', 0.5], ['mouthFrownRight', 0.5]],
  angry: [['browDownLeft', 0.5], ['browDownRight', 0.5]],
  surprised: [['browInnerUp', 0.6], ['eyeWideLeft', 0.2], ['eyeWideRight', 0.2]],
}

async function loadVrm(path: string): Promise<VRM> {
	const buffer = await window.electron.loadVrm(path);
	const loader = new GLTFLoader();
	loader.register((parser) => new VRMLoaderPlugin(parser));
	const gltf = await new Promise<{ userData: { vrm: VRM } }>(
		(resolve, reject) =>
			loader.parse(
				buffer,
				"",
				resolve as (gltf: unknown) => void,
				reject,
			),
	);
	const vrm = gltf.userData.vrm;
	console.log(
		"VRM expressions:",
		vrm.expressionManager?.expressions.map((e) => e.expressionName),
	);
	return vrm;
}

// ---------------------------------------------------------------------------
// MediaPipe face landmarker
// ---------------------------------------------------------------------------

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

async function loadFaceLandmarker(vision: VisionFileset): Promise<FaceLandmarker> {
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

async function loadPoseLandmarker(vision: VisionFileset): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: false
  })
}

async function loadHandLandmarker(vision: VisionFileset): Promise<HandLandmarker> {
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2
  })
}

// ---------------------------------------------------------------------------
// Webcam
// ---------------------------------------------------------------------------

async function openWebcam(
	webcam: AppConfig["webcam"],
): Promise<HTMLVideoElement> {
	const video = document.createElement("video");
	video.style.display = "none";
	document.body.appendChild(video);

	let videoConstraint: MediaTrackConstraints | boolean = true;
	if (webcam?.deviceLabel) {
		const devices = await navigator.mediaDevices.enumerateDevices();
		const match = devices.find(
			(d) => d.kind === "videoinput" && d.label === webcam.deviceLabel,
		);
		if (match) videoConstraint = { deviceId: { exact: match.deviceId } };
	} else if (webcam?.deviceId) {
		videoConstraint = { deviceId: { exact: webcam.deviceId } };
	}

	const stream = await navigator.mediaDevices.getUserMedia({
		video: videoConstraint,
	});
	video.srcObject = stream;
	await video.play();
	return video;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AppConfig = {
  camera: { position: [0, 0.75, 1.1], lookAt: [0, 0.60, 0], fov: 35 },
  model: { path: 'VRMs/Twig-dotter-ARKit.vrm', scale: 1.0, rotation: [0, 180, 0], mirror: false },
  tracking: {
    blendshapeAmplify: { eyeBlinkLeft: 2.0, eyeBlinkRight: 2.0 },
    blendshapeFilter: { minCutoff: 1.0, beta: 0.007 },
    blendshapeFilterOverrides: {
      eyeBlinkLeft: { minCutoff: 10.0, beta: 0.5 },
      eyeBlinkRight: { minCutoff: 10.0, beta: 0.5 },
    },
    headFilter: { minCutoff: 1.5, beta: 0.1 },
    armCalibration: { minCutoff: 1.0, beta: 0.01 },
  }
}

const RAD_TO_DEG = 180 / Math.PI;

async function main(): Promise<void> {
	// Config must resolve first — VRM path comes from it
	const config: AppConfig =
		(await window.electron.loadConfig()) ?? DEFAULT_CONFIG;

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  const [vrm, faceLandmarker, poseLandmarker, handLandmarker, video] = await Promise.all([
    loadVrm(config.model.path),
    loadFaceLandmarker(vision),
    loadPoseLandmarker(vision),
    loadHandLandmarker(vision),
    openWebcam(config.webcam)
  ])

	// Apply camera from config
	const [cx, cy, cz] = config.camera.position;
	const [lx, ly, lz] = config.camera.lookAt;
	camera.position.set(cx, cy, cz);
	camera.fov = config.camera.fov;
	camera.updateProjectionMatrix();
	camera.lookAt(lx, ly, lz);

	// Apply model transform from config (rotation in degrees)
	const [rx, ry, rz] = config.model.rotation.map((d) => (d * Math.PI) / 180);
	vrm.scene.rotation.set(rx, ry, rz);
	vrm.scene.scale.setScalar(config.model.scale);
	scene.add(vrm.scene);

	// Mirror by negating the X scale. This is a simple way to mirror the avatar without needing to adjust the tracking data.
	if (config.model.mirror) {
		vrm.scene.scale.x *= -1;
	}

	// ARKit avatars expose 'jawOpen' as a custom expression — direct pass-through.
	// Standard VRM avatars only have the built-in expression set — use the mapping table.
	const useARKit = vrm.expressionManager?.getValue("jawOpen") !== undefined;

	const { minCutoff: bsMin, beta: bsBeta } = config.tracking.blendshapeFilter;
	const bsOverrides = config.tracking.blendshapeFilterOverrides ?? {};
	const { minCutoff: hMin, beta: hBeta } = config.tracking.headFilter;
	const bsFilters = new Map<string, OneEuroFilter>();
	const headFilters = [
		new OneEuroFilter(hMin, hBeta),
		new OneEuroFilter(hMin, hBeta),
		new OneEuroFilter(hMin, hBeta),
	];

	const headBone = vrm.humanoid?.getNormalizedBoneNode("head");
	const mat4 = new THREE.Matrix4();
	const euler = new THREE.Euler();

  const armBones = {
    left: {
      upper: vrm.humanoid?.getNormalizedBoneNode('leftUpperArm'),
      lower: vrm.humanoid?.getNormalizedBoneNode('leftLowerArm'),
    },
    right: {
      upper: vrm.humanoid?.getNormalizedBoneNode('rightUpperArm'),
      lower: vrm.humanoid?.getNormalizedBoneNode('rightLowerArm'),
    },
  }

  const hb = (name: VRMHumanBoneName) => vrm.humanoid?.getNormalizedBoneNode(name) ?? null
  const handBones = {
    left: {
      wrist: hb('leftHand'),
      thumbMetacarpal: hb('leftThumbMetacarpal'),
      thumbProximal: hb('leftThumbProximal'),
      thumbDistal: hb('leftThumbDistal'),
      indexProximal: hb('leftIndexProximal'),
      indexIntermediate: hb('leftIndexIntermediate'),
      indexDistal: hb('leftIndexDistal'),
      middleProximal: hb('leftMiddleProximal'),
      middleIntermediate: hb('leftMiddleIntermediate'),
      middleDistal: hb('leftMiddleDistal'),
      ringProximal: hb('leftRingProximal'),
      ringIntermediate: hb('leftRingIntermediate'),
      ringDistal: hb('leftRingDistal'),
      littleProximal: hb('leftLittleProximal'),
      littleIntermediate: hb('leftLittleIntermediate'),
      littleDistal: hb('leftLittleDistal'),
    },
    right: {
      wrist: hb('rightHand'),
      thumbMetacarpal: hb('rightThumbMetacarpal'),
      thumbProximal: hb('rightThumbProximal'),
      thumbDistal: hb('rightThumbDistal'),
      indexProximal: hb('rightIndexProximal'),
      indexIntermediate: hb('rightIndexIntermediate'),
      indexDistal: hb('rightIndexDistal'),
      middleProximal: hb('rightMiddleProximal'),
      middleIntermediate: hb('rightMiddleIntermediate'),
      middleDistal: hb('rightMiddleDistal'),
      ringProximal: hb('rightRingProximal'),
      ringIntermediate: hb('rightRingIntermediate'),
      ringDistal: hb('rightRingDistal'),
      littleProximal: hb('rightLittleProximal'),
      littleIntermediate: hb('rightLittleIntermediate'),
      littleDistal: hb('rightLittleDistal'),
    },
  }
  type HandBones = typeof handBones.left

  // 21 landmarks × 3 axes × 2 hands
  const mkHandF = () => Array.from({ length: 21 }, () =>
    [new OneEuroFilter(4.0, 0.5), new OneEuroFilter(4.0, 0.5), new OneEuroFilter(4.0, 0.5)]
  )
  const handFilters = { left: mkHandF(), right: mkHandF() }

  // T-pose rest directions for setFromUnitVectors
  const RIGHT = new THREE.Vector3(1, 0, 0)
  const LEFT = new THREE.Vector3(-1, 0, 0)

  const cal = config.tracking.armCalibration
  const poseScale = new THREE.Vector3(
    cal?.poseScale?.x ?? 1,
    cal?.poseScale?.y ?? 1,
    cal?.poseScale?.z ?? 1,
  )
  const armMin = cal?.minCutoff ?? 2.0
  const armBeta = cal?.beta ?? 0.3

  // One-euro filter per world-landmark axis: [x, y, z]
  const mkF = () => [new OneEuroFilter(armMin, armBeta), new OneEuroFilter(armMin, armBeta), new OneEuroFilter(armMin, armBeta)]
  const poseFilters = {
    leftShoulder: mkF(), rightShoulder: mkF(),
    leftElbow: mkF(), rightElbow: mkF(),
    leftWrist: mkF(), rightWrist: mkF(),
  }

  // MediaPipe pose world space: +X toward person's left, +Y up, +Z toward camera.
  // Three.js world space: +X right (person's right), +Y up, +Z toward camera.
  // Flip X to convert.
  const filterLm = (
    f: ReturnType<typeof mkF>,
    lm: { x: number; y: number; z: number },
    t: number
  ): THREE.Vector3 =>
    new THREE.Vector3(
      f[0].filter(-lm.x, t),
      f[1].filter(-lm.y, t),
      f[2].filter(lm.z, t)
    )


  // Some models (especially furries) only have eight fingers total (no separate ring finger joints). 
  // For these, I find that applying the ring finger's pose to the little finger makes the little finger stick out less awkwardly when the hand is open. 
  // This is a simple heuristic and won't work well in all cases, but it seems to help more often than not.

  const hasRingFinger = (!handBones.left.littleProximal && handBones.left.ringProximal && handBones.left.littleProximal === null)

  // Define HLM based on hasRingFinger
  const HLM = hasRingFinger ? {
    WRIST: 0,
    THUMB: [1, 2, 3, 4],
    INDEX: [5, 6, 7, 8],
    MIDDLE: [9, 10, 11, 12],
    RING: [13, 14, 15, 16],
    LITTLE: [17, 18, 19, 20],
  } : {
    WRIST: 0,
    THUMB: [1, 2, 3, 4],
    INDEX: [5, 6, 7, 8],
    MIDDLE: [9, 10, 11, 12],
    RING: [17, 18, 19, 20],
    LITTLE: [13, 14, 15, 16],
  };

  function applyHandPose(pts: THREE.Vector3[], side: 'left' | 'right', bones: HandBones, lowerArmWorldQuat: THREE.Quaternion): void {
    const restDir = side === 'right' ? RIGHT.clone() : LEFT.clone()
    const invLower = lowerArmWorldQuat.clone().invert()

    // --- Wrist rotation (full 3-DOF: pitch+yaw via setFromUnitVectors, roll via twist) ---
    const wristQuat = new THREE.Quaternion()
    if (bones.wrist) {
      const fingerDir = pts[HLM.MIDDLE[0]].clone().sub(pts[HLM.WRIST]).normalize()
      const sideVec = pts[HLM.INDEX[0]].clone().sub(pts[HLM.LITTLE[0]])
      if (side === 'left') sideVec.negate() // Left hand's "side" vector points from little to index, opposite of right hand
      const handNorm = new THREE.Vector3().crossVectors(fingerDir, sideVec).normalize()

      // Step 1: align finger direction (pitch + yaw)
      const fingerLocal = fingerDir.clone().applyQuaternion(invLower)
      const q1 = new THREE.Quaternion().setFromUnitVectors(restDir, fingerLocal)

      // Step 2: align palm normal (roll) — twist around the finger axis
      const normLocal = handNorm.clone().applyQuaternion(invLower)
      const nominalNorm = new THREE.Vector3(0, 1, 0).applyQuaternion(q1)
      const fd = fingerLocal.clone().normalize()
      const nomPerp = nominalNorm.clone().addScaledVector(fd, -nominalNorm.dot(fd))
      const actPerp = normLocal.clone().addScaledVector(fd, -normLocal.dot(fd))
      if (nomPerp.lengthSq() > 1e-6 && actPerp.lengthSq() > 1e-6) {
        const q2 = new THREE.Quaternion().setFromUnitVectors(nomPerp.normalize(), actPerp.normalize())
        wristQuat.copy(q2.multiply(q1))
      } else {
        wristQuat.copy(q1)
      }
      bones.wrist.quaternion.copy(wristQuat)
    }

    // Hand world quat = lower arm world × wrist local
    const handWorldQuat = lowerArmWorldQuat.clone().multiply(wristQuat)

    // --- Finger chains: [landmark indices], [bones] ---
    const chains: [number[], (THREE.Object3D | null)[]][] = [
      [HLM.THUMB, [bones.thumbMetacarpal, bones.thumbProximal, bones.thumbDistal]],
      [HLM.INDEX, [bones.indexProximal, bones.indexIntermediate, bones.indexDistal]],
      [HLM.MIDDLE, [bones.middleProximal, bones.middleIntermediate, bones.middleDistal]],
      [HLM.RING, [bones.ringProximal, bones.ringIntermediate, bones.ringDistal]],
      [HLM.LITTLE, [bones.littleProximal, bones.littleIntermediate, bones.littleDistal]],
    ]

    for (const [lm, fingerBones] of chains) {
      let parentQuat = handWorldQuat.clone()
      for (let i = 0; i < fingerBones.length; i++) {
        const seg = pts[lm[i + 1]].clone().sub(pts[lm[i]])
        if (seg.lengthSq() < 1e-8) { parentQuat = parentQuat.clone().multiply(new THREE.Quaternion()); continue }
        const segLocal = seg.normalize().applyQuaternion(parentQuat.clone().invert())
        const boneQuat = new THREE.Quaternion().setFromUnitVectors(restDir, segLocal)
        fingerBones[i]?.quaternion.copy(boneQuat)
        parentQuat = parentQuat.clone().multiply(boneQuat)
      }
    }
  }

  function resetHandBones(bones: HandBones): void {
    for (const bone of Object.values(bones)) bone?.quaternion.identity()
  }

  const clock = new THREE.Clock()
  let lastVideoTime = -1

	function animate(): void {
		requestAnimationFrame(animate);
		const delta = clock.getDelta();
		const now = performance.now();

    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const ts = video.currentTime * 1000
      const result = faceLandmarker.detectForVideo(video, ts)
      const poseResult = poseLandmarker.detectForVideo(video, ts + 1)

			const debugBlendshapes: DebugData["blendshapes"] = [];
			let debugHead: DebugData["head"] = { pitch: 0, yaw: 0, roll: 0 };
			const detected = !!(
				result.faceBlendshapes?.[0] ||
				result.facialTransformationMatrixes?.[0]
			);

			// --- Blendshapes ---
			const shapes = result.faceBlendshapes?.[0]?.categories;
			const em = vrm.expressionManager;

			if (shapes && em) {
				if (useARKit) {
					for (const shape of shapes) {
						const name = shape.categoryName;
						const amplify =
							config.tracking.blendshapeAmplify[name] ?? 1;
						const raw = Math.min(1, shape.score * amplify);
						if (!bsFilters.has(name)) {
							const p = bsOverrides[name] ?? {
								minCutoff: bsMin,
								beta: bsBeta,
							};
							bsFilters.set(
								name,
								new OneEuroFilter(p.minCutoff, p.beta),
							);
						}
						const filtered = bsFilters.get(name)!.filter(raw, now);
						em.setValue(name, filtered);
						debugBlendshapes.push({ name, value: filtered });
					}
				} else {
					const scoreMap = new Map(
						shapes.map((s) => [s.categoryName, s.score]),
					);
					for (const [vrmExpr, sources] of Object.entries(
						STANDARD_VRM_MAP,
					)) {
						if (em.getValue(vrmExpr) === undefined) continue;
						const raw = Math.min(
							1,
							sources.reduce(
								(sum, [src, w]) =>
									sum + (scoreMap.get(src) ?? 0) * w,
								0,
							),
						);
						if (!bsFilters.has(vrmExpr))
							bsFilters.set(
								vrmExpr,
								new OneEuroFilter(bsMin, bsBeta),
							);
						const filtered = bsFilters
							.get(vrmExpr)!
							.filter(raw, now);
						em.setValue(vrmExpr, filtered);
						debugBlendshapes.push({
							name: vrmExpr,
							value: filtered,
						});
					}
				}
				em.update();
			}

      // --- Head rotation ---
      const txMatrix = result.facialTransformationMatrixes?.[0]
      if (txMatrix && headBone) {
        // MediaPipe outputs a column-major 4x4 matrix (OpenGL convention) in camera space.
        // If any axis feels inverted when testing, flip its sign here.
        // To mirror the model, you can also apply a 180° rotation to the Y axis in the config and flip the signs of the X and Z axes here.
        mat4.fromArray(txMatrix.data)
        euler.setFromRotationMatrix(mat4, 'YXZ')
        const hx = headFilters[0].filter(-euler.x, now)
        const hy = headFilters[1].filter(euler.y, now)
        const hz = headFilters[2].filter(-euler.z, now)
        headBone.quaternion.setFromEuler(new THREE.Euler(hx, hy, hz, 'YXZ'))
        debugHead = {
          pitch: hx * RAD_TO_DEG,
          yaw: hy * RAD_TO_DEG,
          roll: hz * RAD_TO_DEG,
        }
      }

      // --- Arms (pose) ---
      const debugArms: DebugData['arms'] = []
      const wlms = poseResult.worldLandmarks[0]
      if (wlms) {
        // MediaPipe pose landmark indices
        const LSHO = 11, RSHO = 12, LELB = 13, RELB = 14, LWRI = 15, RWRI = 16

        const lSho = filterLm(poseFilters.leftShoulder, wlms[LSHO], now)
        const rSho = filterLm(poseFilters.rightShoulder, wlms[RSHO], now)
        const lElb = filterLm(poseFilters.leftElbow, wlms[LELB], now)
        const rElb = filterLm(poseFilters.rightElbow, wlms[RELB], now)
        const lWri = filterLm(poseFilters.leftWrist, wlms[LWRI], now)
        const rWri = filterLm(poseFilters.rightWrist, wlms[RWRI], now)

        // Right arm
        if (armBones.right.upper && armBones.right.lower) {
          const upperDir = rElb.clone().sub(rSho).multiply(poseScale).normalize()
          armBones.right.upper.quaternion.setFromUnitVectors(RIGHT, upperDir)
          const lowerDir = rWri.clone().sub(rElb).multiply(poseScale).normalize()
          const lowerLocal = lowerDir.applyQuaternion(armBones.right.upper.quaternion.clone().invert())
          armBones.right.lower.quaternion.setFromUnitVectors(RIGHT, lowerLocal)
          debugArms.push(
            { name: 'R upper X', value: upperDir.x },
            { name: 'R upper Y', value: upperDir.y },
            { name: 'R upper Z', value: upperDir.z },
            { name: 'R lower X', value: lowerLocal.x },
            { name: 'R lower Y', value: lowerLocal.y },
            { name: 'R lower Z', value: lowerLocal.z },
          )
        }

        // Left arm
        if (armBones.left.upper && armBones.left.lower) {
          const upperDir = lElb.clone().sub(lSho).multiply(poseScale).normalize()
          armBones.left.upper.quaternion.setFromUnitVectors(LEFT, upperDir)
          const lowerDir = lWri.clone().sub(lElb).multiply(poseScale).normalize()
          const lowerLocal = lowerDir.applyQuaternion(armBones.left.upper.quaternion.clone().invert())
          armBones.left.lower.quaternion.setFromUnitVectors(LEFT, lowerLocal)
          debugArms.push(
            { name: 'L upper X', value: upperDir.x },
            { name: 'L upper Y', value: upperDir.y },
            { name: 'L upper Z', value: upperDir.z },
            { name: 'L lower X', value: lowerLocal.x },
            { name: 'L lower Y', value: lowerLocal.y },
            { name: 'L lower Z', value: lowerLocal.z },
          )
        }
      }

      // --- Hands ---
      const handResult = handLandmarker.detectForVideo(video, ts + 2)
      const detectedSides = new Set<'left' | 'right'>()

      for (let h = 0; h < handResult.worldLandmarks.length; h++) {
        const categoryName = handResult.handednesses[h]?.[0]?.categoryName
        if (!categoryName) continue
        const side = categoryName === 'Left' ? 'left' : 'right'
        detectedSides.add(side)

        const wh = handResult.worldLandmarks[h]
        const hf = handFilters[side]
        const pts = wh.map((lm: { x: number; y: number; z: number }, i: number) => new THREE.Vector3(
          hf[i][0].filter(-lm.x, now),
          hf[i][1].filter(-lm.y, now),
          hf[i][2].filter(lm.z, now),
        ))

        const ab = armBones[side]
        if (ab.upper && ab.lower) {
          const lowerArmWorldQuat = ab.upper.quaternion.clone().multiply(ab.lower.quaternion)
          applyHandPose(pts, side, handBones[side], lowerArmWorldQuat)
        }
      }

      for (const side of ['left', 'right'] as const) {
        if (!detectedSides.has(side)) resetHandBones(handBones[side])
      }

      window.electron.sendDebugData({ detected, blendshapes: debugBlendshapes, head: debugHead, arms: debugArms })
    }

		vrm.update(delta);
		renderer.render(scene, camera);
	}

	animate();
}

main().catch(console.error);
