import * as THREE from "three";
import { VRMHumanBoneName } from "@pixiv/three-vrm";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import { OneEuroFilter } from "./one-euro-filter";
import { openMic, getMicAmplitude } from "./audio";
import {
	loadFaceLandmarker,
	loadPoseLandmarker,
	loadHandLandmarker,
} from "./landmarkers";
import { loadVrm, openWebcam } from "./loaders";
import { RIGHT, LEFT, HandBoneSet, buildHLM, applyHandPose } from "./hand-pose";

// ---------------------------------------------------------------------------
// Scene setup
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
// Constants
// ---------------------------------------------------------------------------

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Fallback blendshape mapping for avatars that only expose standard VRM 1.x expressions.
 * Each entry maps an internal expression name to one or more [ARKitBlendshapeName, weight]
 * sources. Multiple sources are summed and clamped to [0, 1].
 */
const STANDARD_VRM_MAP: Record<string, [string, number][]> = {
	blinkLeft: [["eyeBlinkLeft", 1]],
	blinkRight: [["eyeBlinkRight", 1]],
	aa: [["jawOpen", 1]],
	ih: [["mouthClose", 0.6]],
	ou: [["mouthPucker", 1]],
	ee: [
		["mouthStretchLeft", 0.5],
		["mouthStretchRight", 0.5],
	],
	oh: [
		["jawOpen", 0.4],
		["mouthFunnel", 0.6],
	],
	happy: [
		["mouthSmileLeft", 0.5],
		["mouthSmileRight", 0.5],
	],
	sad: [
		["mouthFrownLeft", 0.5],
		["mouthFrownRight", 0.5],
	],
	angry: [
		["browDownLeft", 0.5],
		["browDownRight", 0.5],
	],
	surprised: [
		["browInnerUp", 0.6],
		["eyeWideLeft", 0.2],
		["eyeWideRight", 0.2],
	],
};

/** Default config values used when no config.json is present on disk. */
const DEFAULT_CONFIG: AppConfig = {
	camera: { position: [0, 0.75, 1.1], lookAt: [0, 0.6, 0], fov: 35 },
	audio: { enabled: true },
	model: {
		path: "VRMs/Twig-dotter-ARKit.vrm",
		scale: 1.0,
		rotation: [0, 180, 0],
		mirror: false,
	},
	tracking: {
		blendshapeAmplify: { eyeBlinkLeft: 2.0, eyeBlinkRight: 2.0 },
		blendshapeFilter: { minCutoff: 1.0, beta: 0.007 },
		blendshapeFilterOverrides: {
			eyeBlinkLeft: { minCutoff: 10.0, beta: 0.5 },
			eyeBlinkRight: { minCutoff: 10.0, beta: 0.5 },
		},
		headFilter: { minCutoff: 1.5, beta: 0.1 },
		armCalibration: { minCutoff: 1.0, beta: 0.01 },
		handFilter: { minCutoff: 4.0, beta: 0.5 },
	},
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Entry point: loads config, initialises MediaPipe/VRM/webcam, starts the render loop. */
async function main(): Promise<void> {
	// Config must resolve first — VRM path comes from it
	const config: AppConfig =
		(await window.electron.loadConfig()) ?? DEFAULT_CONFIG;

	const vision = await FilesetResolver.forVisionTasks(
		"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
	);

	const [
		vrm,
		faceLandmarker,
		poseLandmarker,
		handLandmarker,
		video,
		audioState,
	] = await Promise.all([
		loadVrm(config.model.path),
		loadFaceLandmarker(vision),
		loadPoseLandmarker(vision),
		loadHandLandmarker(vision),
		openWebcam(config.webcam),
		openMic(config.audio),
	]);

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

	// Mirror by negating the X scale.
	if (config.model.mirror) vrm.scene.scale.x *= -1;

	// ARKit avatars expose 'jawOpen' as a custom expression — direct pass-through.
	// Standard VRM avatars only have the built-in expression set — use STANDARD_VRM_MAP.
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
			upper: vrm.humanoid?.getNormalizedBoneNode("leftUpperArm"),
			lower: vrm.humanoid?.getNormalizedBoneNode("leftLowerArm"),
		},
		right: {
			upper: vrm.humanoid?.getNormalizedBoneNode("rightUpperArm"),
			lower: vrm.humanoid?.getNormalizedBoneNode("rightLowerArm"),
		},
	};

	const hb = (name: VRMHumanBoneName) =>
		vrm.humanoid?.getNormalizedBoneNode(name) ?? null;

	const handBones: { left: HandBoneSet; right: HandBoneSet } = {
		left: {
			wrist: hb("leftHand"),
			thumbMetacarpal: hb("leftThumbMetacarpal"),
			thumbProximal: hb("leftThumbProximal"),
			thumbDistal: hb("leftThumbDistal"),
			indexProximal: hb("leftIndexProximal"),
			indexIntermediate: hb("leftIndexIntermediate"),
			indexDistal: hb("leftIndexDistal"),
			middleProximal: hb("leftMiddleProximal"),
			middleIntermediate: hb("leftMiddleIntermediate"),
			middleDistal: hb("leftMiddleDistal"),
			ringProximal: hb("leftRingProximal"),
			ringIntermediate: hb("leftRingIntermediate"),
			ringDistal: hb("leftRingDistal"),
			littleProximal: hb("leftLittleProximal"),
			littleIntermediate: hb("leftLittleIntermediate"),
			littleDistal: hb("leftLittleDistal"),
		},
		right: {
			wrist: hb("rightHand"),
			thumbMetacarpal: hb("rightThumbMetacarpal"),
			thumbProximal: hb("rightThumbProximal"),
			thumbDistal: hb("rightThumbDistal"),
			indexProximal: hb("rightIndexProximal"),
			indexIntermediate: hb("rightIndexIntermediate"),
			indexDistal: hb("rightIndexDistal"),
			middleProximal: hb("rightMiddleProximal"),
			middleIntermediate: hb("rightMiddleIntermediate"),
			middleDistal: hb("rightMiddleDistal"),
			ringProximal: hb("rightRingProximal"),
			ringIntermediate: hb("rightRingIntermediate"),
			ringDistal: hb("rightRingDistal"),
			littleProximal: hb("rightLittleProximal"),
			littleIntermediate: hb("rightLittleIntermediate"),
			littleDistal: hb("rightLittleDistal"),
		},
	};

	// 21 landmarks × 3 axes × 2 hands
	const hfMinCutoff = config.tracking.handFilter?.minCutoff ?? 4.0;
	const hfBeta = config.tracking.handFilter?.beta ?? 0.5;
	const mkHandF = () =>
		Array.from({ length: 21 }, () => [
			new OneEuroFilter(hfMinCutoff, hfBeta),
			new OneEuroFilter(hfMinCutoff, hfBeta),
			new OneEuroFilter(hfMinCutoff, hfBeta),
		]);
	const handFilters = { left: mkHandF(), right: mkHandF() };

	const cal = config.tracking.armCalibration;
	const poseScale = new THREE.Vector3(
		cal?.poseScale?.x ?? 1,
		cal?.poseScale?.y ?? 1,
		cal?.poseScale?.z ?? 1,
	);
	const armMin = cal?.minCutoff ?? 2.0;
	const armBeta = cal?.beta ?? 0.3;

	/** Creates a triplet of one-euro filters for a single 3D world landmark. */
	const mkF = () => [
		new OneEuroFilter(armMin, armBeta),
		new OneEuroFilter(armMin, armBeta),
		new OneEuroFilter(armMin, armBeta),
	];
	const poseFilters = {
		leftShoulder: mkF(),
		rightShoulder: mkF(),
		leftElbow: mkF(),
		rightElbow: mkF(),
		leftWrist: mkF(),
		rightWrist: mkF(),
	};

	// MediaPipe pose world space: +X toward person's left, +Y up, +Z toward camera.
	// Three.js world space: +X right (person's right), +Y up, +Z toward camera. Flip X.
	const filterLm = (
		f: ReturnType<typeof mkF>,
		lm: { x: number; y: number; z: number },
		t: number,
	): THREE.Vector3 =>
		new THREE.Vector3(
			f[0].filter(-lm.x, t),
			f[1].filter(-lm.y, t),
			f[2].filter(lm.z, t),
		);

	// Some models (especially furries) have no separate ring finger joints.
	// When ring bone is present but little is absent, swap ring↔little landmark groups
	// so the ring-finger pose drives the little-finger bones instead.
	const hasRingFinger =
		!handBones.left.littleProximal &&
		!!handBones.left.ringProximal &&
		handBones.left.littleProximal === null;
	const hlm = buildHLM(hasRingFinger);

	/** Returns true for blendshape names that control mouth/jaw movement. */
	const MOUTH_BLENDSHAPES = new Set(["aa", "ih", "ou", "ee", "oh"]);
	function isMouthBlendshape(name: string): boolean {
		return (
			name.startsWith("mouth") ||
			name.startsWith("jaw") ||
			MOUTH_BLENDSHAPES.has(name)
		);
	}

	const clock = new THREE.Clock();
	let lastVideoTime = -1;

	/** Per-frame render + tracking loop. Processes each webcam frame exactly once. */
	function animate(): void {
		requestAnimationFrame(animate);
		const delta = clock.getDelta();
		const now = performance.now();

		if (video.currentTime !== lastVideoTime) {
			lastVideoTime = video.currentTime;
			const ts = video.currentTime * 1000;
			const faceResult = faceLandmarker.detectForVideo(video, ts);
			const poseResult = poseLandmarker.detectForVideo(video, ts + 1);

			const debugBlendshapes: DebugData["blendshapes"] = [];
			let debugHead: DebugData["head"] = { pitch: 0, yaw: 0, roll: 0 };
			const detected = !!(
				faceResult.faceBlendshapes?.[0] ||
				faceResult.facialTransformationMatrixes?.[0]
			);

			// Mic amplitude drives mouth-filter responsiveness: loud = looser filter.
			const micAmp = audioState ? getMicAmplitude(audioState) : 0;
			const mouthCfg = config.tracking.mouthFilter;
			const noiseFloor = mouthCfg?.noiseFloor ?? 0.01;
			const minCutoffSilent = mouthCfg?.minCutoffSilent ?? bsMin;
			const minCutoffTalking = mouthCfg?.minCutoffTalking ?? 8.0;
			const amplitudeScale = mouthCfg?.amplitudeScale ?? 2;
			// Normalise amplitude above the noise floor to a 0–1 drive value.
			const mouthDrive = Math.min(
				1,
				Math.max(0, micAmp - noiseFloor) / (0.1 - noiseFloor),
			);

			// --- Blendshapes ---
			const shapes = faceResult.faceBlendshapes?.[0]?.categories;
			const em = vrm.expressionManager;

			if (shapes && em) {
				if (useARKit) {
					for (const shape of shapes) {
						const name = shape.categoryName;
						const amplify =
							config.tracking.blendshapeAmplify[name] ?? 1;
						const baseRaw = Math.min(1, shape.score * amplify);
						const raw =
							isMouthBlendshape(name) ?
								Math.min(
									1,
									baseRaw * (1 + micAmp * amplitudeScale),
								)
							:	baseRaw;
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
						const f = bsFilters.get(name)!;
						// Loosen the mouth filter when the mic is active.
						if (isMouthBlendshape(name)) {
							f.minCutoff =
								minCutoffSilent +
								(minCutoffTalking - minCutoffSilent) *
									mouthDrive;
						}
						const filtered = f.filter(raw, now);
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
						const baseRaw = Math.min(
							1,
							sources.reduce(
								(sum, [src, w]) =>
									sum + (scoreMap.get(src) ?? 0) * w,
								0,
							),
						);
						const raw =
							isMouthBlendshape(vrmExpr) ?
								Math.min(
									1,
									baseRaw * (1 + micAmp * amplitudeScale),
								)
							:	baseRaw;
						if (!bsFilters.has(vrmExpr))
							bsFilters.set(
								vrmExpr,
								new OneEuroFilter(bsMin, bsBeta),
							);
						const f = bsFilters.get(vrmExpr)!;
						if (isMouthBlendshape(vrmExpr)) {
							f.minCutoff =
								minCutoffSilent +
								(minCutoffTalking - minCutoffSilent) *
									mouthDrive;
						}
						const filtered = f.filter(raw, now);
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
			const txMatrix = faceResult.facialTransformationMatrixes?.[0];
			if (txMatrix && headBone) {
				// MediaPipe outputs a column-major 4x4 matrix (OpenGL convention) in camera space.
				// If any axis feels inverted when testing, flip its sign here.
				mat4.fromArray(txMatrix.data);
				euler.setFromRotationMatrix(mat4, "YXZ");
				const hx = headFilters[0].filter(-euler.x, now);
				const hy = headFilters[1].filter(euler.y, now);
				const hz = headFilters[2].filter(-euler.z, now);
				headBone.quaternion.setFromEuler(
					new THREE.Euler(hx, hy, hz, "YXZ"),
				);
				debugHead = {
					pitch: hx * RAD_TO_DEG,
					yaw: hy * RAD_TO_DEG,
					roll: hz * RAD_TO_DEG,
				};
			}

			// --- Arms (pose) ---
			const debugArms: DebugData["arms"] = [];
			const wlms = poseResult.worldLandmarks[0];
			if (wlms) {
				// MediaPipe pose landmark indices
				const LSHO = 11,
					RSHO = 12,
					LELB = 13,
					RELB = 14,
					LWRI = 15,
					RWRI = 16;

				const lSho = filterLm(
					poseFilters.leftShoulder,
					wlms[LSHO],
					now,
				);
				const rSho = filterLm(
					poseFilters.rightShoulder,
					wlms[RSHO],
					now,
				);
				const lElb = filterLm(poseFilters.leftElbow, wlms[LELB], now);
				const rElb = filterLm(poseFilters.rightElbow, wlms[RELB], now);
				const lWri = filterLm(poseFilters.leftWrist, wlms[LWRI], now);
				const rWri = filterLm(poseFilters.rightWrist, wlms[RWRI], now);

				// Right arm
				if (armBones.right.upper && armBones.right.lower) {
					const upperDir = rElb
						.clone()
						.sub(rSho)
						.multiply(poseScale)
						.normalize();
					armBones.right.upper.quaternion.setFromUnitVectors(
						RIGHT,
						upperDir,
					);
					const lowerDir = rWri
						.clone()
						.sub(rElb)
						.multiply(poseScale)
						.normalize();
					const lowerLocal = lowerDir.applyQuaternion(
						armBones.right.upper.quaternion.clone().invert(),
					);
					armBones.right.lower.quaternion.setFromUnitVectors(
						RIGHT,
						lowerLocal,
					);
					debugArms.push(
						{ name: "R upper X", value: upperDir.x },
						{ name: "R upper Y", value: upperDir.y },
						{ name: "R upper Z", value: upperDir.z },
						{ name: "R lower X", value: lowerLocal.x },
						{ name: "R lower Y", value: lowerLocal.y },
						{ name: "R lower Z", value: lowerLocal.z },
					);
				}

				// Left arm
				if (armBones.left.upper && armBones.left.lower) {
					const upperDir = lElb
						.clone()
						.sub(lSho)
						.multiply(poseScale)
						.normalize();
					armBones.left.upper.quaternion.setFromUnitVectors(
						LEFT,
						upperDir,
					);
					const lowerDir = lWri
						.clone()
						.sub(lElb)
						.multiply(poseScale)
						.normalize();
					const lowerLocal = lowerDir.applyQuaternion(
						armBones.left.upper.quaternion.clone().invert(),
					);
					armBones.left.lower.quaternion.setFromUnitVectors(
						LEFT,
						lowerLocal,
					);
					debugArms.push(
						{ name: "L upper X", value: upperDir.x },
						{ name: "L upper Y", value: upperDir.y },
						{ name: "L upper Z", value: upperDir.z },
						{ name: "L lower X", value: lowerLocal.x },
						{ name: "L lower Y", value: lowerLocal.y },
						{ name: "L lower Z", value: lowerLocal.z },
					);
				}
			}

			// --- Hands ---
			const handResult = handLandmarker.detectForVideo(video, ts + 2);
			const detectedSides = new Set<"left" | "right">();

			for (let h = 0; h < handResult.worldLandmarks.length; h++) {
				const categoryName =
					handResult.handednesses[h]?.[0]?.categoryName;
				if (!categoryName) continue;
				const side = categoryName === "Left" ? "left" : "right";
				detectedSides.add(side);

				const wh = handResult.worldLandmarks[h];
				const hf = handFilters[side];
				const pts = wh.map(
					(lm: { x: number; y: number; z: number }, i: number) =>
						new THREE.Vector3(
							hf[i][0].filter(-lm.x, now),
							hf[i][1].filter(-lm.y, now),
							hf[i][2].filter(lm.z, now),
						),
				);

				const ab = armBones[side];
				if (ab.upper && ab.lower) {
					const lowerArmWorldQuat = ab.upper.quaternion
						.clone()
						.multiply(ab.lower.quaternion);
					applyHandPose(
						pts,
						side,
						handBones[side],
						lowerArmWorldQuat,
						ab.lower,
						hlm,
					);
				}
			}

			window.electron.sendDebugData({
				detected,
				blendshapes: debugBlendshapes,
				head: debugHead,
				arms: debugArms,
				audio:
					audioState ?
						[
							{ name: "amplitude", value: micAmp },
							{ name: "mouth drive", value: mouthDrive },
						]
					:	undefined,
			});
		}

		vrm.update(delta);
		renderer.render(scene, camera);
	}

	animate();
}

main().catch(console.error);
