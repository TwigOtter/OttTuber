import * as THREE from "three";

/** T-pose rest direction for the right arm/hand (points along +X). */
export const RIGHT = new THREE.Vector3(1, 0, 0);

/** T-pose rest direction for the left arm/hand (points along -X). */
export const LEFT = new THREE.Vector3(-1, 0, 0);

/**
 * Fraction of wrist roll redistributed to the lower arm bone.
 * Splitting the roll makes the forearm visually twist with the hand.
 */
export const FOREARM_ROLL_FRACTION = 0.6;

/** All finger/wrist bone references for one hand. */
export interface HandBoneSet {
	wrist: THREE.Object3D | null;
	thumbMetacarpal: THREE.Object3D | null;
	thumbProximal: THREE.Object3D | null;
	thumbDistal: THREE.Object3D | null;
	indexProximal: THREE.Object3D | null;
	indexIntermediate: THREE.Object3D | null;
	indexDistal: THREE.Object3D | null;
	middleProximal: THREE.Object3D | null;
	middleIntermediate: THREE.Object3D | null;
	middleDistal: THREE.Object3D | null;
	ringProximal: THREE.Object3D | null;
	ringIntermediate: THREE.Object3D | null;
	ringDistal: THREE.Object3D | null;
	littleProximal: THREE.Object3D | null;
	littleIntermediate: THREE.Object3D | null;
	littleDistal: THREE.Object3D | null;
}

/**
 * Builds the MediaPipe hand landmark index groups for each finger.
 * When the avatar has no separate ring-finger joints (e.g. eight-fingered furry rigs),
 * the ring and little landmark groups are swapped so the ring-finger pose drives
 * the little-finger bones instead, preventing the little finger from sticking out.
 */
export function buildHLM(hasRingFinger: boolean) {
	return hasRingFinger ?
			{
				WRIST: 0,
				THUMB: [1, 2, 3, 4],
				INDEX: [5, 6, 7, 8],
				MIDDLE: [9, 10, 11, 12],
				RING: [13, 14, 15, 16],
				LITTLE: [17, 18, 19, 20],
			}
		:	{
				WRIST: 0,
				THUMB: [1, 2, 3, 4],
				INDEX: [5, 6, 7, 8],
				MIDDLE: [9, 10, 11, 12],
				RING: [17, 18, 19, 20],
				LITTLE: [13, 14, 15, 16],
			};
}

export type HLM = ReturnType<typeof buildHLM>;

/**
 * Drives all finger and wrist bones for one hand from MediaPipe world landmarks.
 *
 * Wrist rotation is decomposed into pitch+yaw (setFromUnitVectors) and roll (twist),
 * with the roll split between the lower arm and wrist bone via FOREARM_ROLL_FRACTION
 * for a natural-looking forearm twist. Finger chains are solved segment by segment
 * in the hand's local space.
 */
export function applyHandPose(
	pts: THREE.Vector3[],
	side: "left" | "right",
	bones: HandBoneSet,
	lowerArmWorldQuat: THREE.Quaternion,
	lowerArmBone: THREE.Object3D,
	hlm: HLM,
): void {
	const restDir = side === "right" ? RIGHT.clone() : LEFT.clone();
	const invLower = lowerArmWorldQuat.clone().invert();

	// --- Wrist rotation (full 3-DOF: pitch+yaw via setFromUnitVectors, roll via twist) ---
	const wristQuat = new THREE.Quaternion();
	const fullWristQuat = new THREE.Quaternion(); // q2*q1, used for finger parent space
	if (bones.wrist) {
		const fingerDir = pts[hlm.MIDDLE[0]]
			.clone()
			.sub(pts[hlm.WRIST])
			.normalize();
		const sideVec = pts[hlm.INDEX[0]].clone().sub(pts[hlm.LITTLE[0]]);
		if (side === "left") sideVec.negate(); // Left hand's side vector points little→index, opposite of right
		const handNorm = new THREE.Vector3()
			.crossVectors(fingerDir, sideVec)
			.normalize();

		// Step 1: align finger direction (pitch + yaw)
		const fingerLocal = fingerDir.clone().applyQuaternion(invLower);
		const q1 = new THREE.Quaternion().setFromUnitVectors(
			restDir,
			fingerLocal,
		);

		// Step 2: align palm normal (roll) — twist around the finger axis
		const normLocal = handNorm.clone().applyQuaternion(invLower);
		const nominalNorm = new THREE.Vector3(0, 1, 0).applyQuaternion(q1);
		const fd = fingerLocal.clone().normalize();
		const nomPerp = nominalNorm
			.clone()
			.addScaledVector(fd, -nominalNorm.dot(fd));
		const actPerp = normLocal
			.clone()
			.addScaledVector(fd, -normLocal.dot(fd));
		if (nomPerp.lengthSq() > 1e-6 && actPerp.lengthSq() > 1e-6) {
			const q2 = new THREE.Quaternion().setFromUnitVectors(
				nomPerp.normalize(),
				actPerp.normalize(),
			);
			// Split roll: FOREARM_ROLL_FRACTION goes to the lower arm bone so it
			// visually twists with the hand; the remainder stays on the wrist bone.
			// fullWristQuat (q2*q1) is preserved for finger parent-space so finger
			// world positions are unaffected by the split.
			const q2Forearm = new THREE.Quaternion().slerp(
				q2,
				FOREARM_ROLL_FRACTION,
			);
			const q2Wrist = q2Forearm.clone().invert().multiply(q2);
			lowerArmBone.quaternion.multiply(q2Forearm);
			fullWristQuat.copy(q2.clone().multiply(q1));
			wristQuat.copy(q2Wrist.multiply(q1));
		} else {
			fullWristQuat.copy(q1);
			wristQuat.copy(q1);
		}
		bones.wrist.quaternion.copy(wristQuat);
	}

	// Finger parent space uses the full wrist rotation so world positions are
	// unchanged by the forearm/wrist roll split above.
	const handWorldQuat = lowerArmWorldQuat.clone().multiply(fullWristQuat);

	// --- Finger chains: [landmark indices], [bones] ---
	const chains: [number[], (THREE.Object3D | null)[]][] = [
		[
			hlm.THUMB,
			[bones.thumbMetacarpal, bones.thumbProximal, bones.thumbDistal],
		],
		[
			hlm.INDEX,
			[bones.indexProximal, bones.indexIntermediate, bones.indexDistal],
		],
		[
			hlm.MIDDLE,
			[
				bones.middleProximal,
				bones.middleIntermediate,
				bones.middleDistal,
			],
		],
		[
			hlm.RING,
			[bones.ringProximal, bones.ringIntermediate, bones.ringDistal],
		],
		[
			hlm.LITTLE,
			[
				bones.littleProximal,
				bones.littleIntermediate,
				bones.littleDistal,
			],
		],
	];

	for (const [lm, fingerBones] of chains) {
		let parentQuat = handWorldQuat.clone();
		for (let i = 0; i < fingerBones.length; i++) {
			const seg = pts[lm[i + 1]].clone().sub(pts[lm[i]]);
			if (seg.lengthSq() < 1e-8) {
				parentQuat = parentQuat
					.clone()
					.multiply(new THREE.Quaternion());
				continue;
			}
			const segLocal = seg
				.normalize()
				.applyQuaternion(parentQuat.clone().invert());
			const boneQuat = new THREE.Quaternion().setFromUnitVectors(
				restDir,
				segLocal,
			);
			fingerBones[i]?.quaternion.copy(boneQuat);
			parentQuat = parentQuat.clone().multiply(boneQuat);
		}
	}
}
