import {
	FaceLandmarker,
	PoseLandmarker,
	HandLandmarker,
	FilesetResolver,
} from "@mediapipe/tasks-vision";

export type VisionFileset = Awaited<
	ReturnType<typeof FilesetResolver.forVisionTasks>
>;

/**
 * Creates a MediaPipe FaceLandmarker configured for ARKit-compatible 52
 * blendshapes and facial transformation matrix output.
 */
export async function loadFaceLandmarker(
	vision: VisionFileset,
): Promise<FaceLandmarker> {
	return FaceLandmarker.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath:
				"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
			delegate: "GPU",
		},
		outputFaceBlendshapes: true,
		outputFacialTransformationMatrixes: true,
		runningMode: "VIDEO",
		numFaces: 1,
	});
}

/** Creates a MediaPipe PoseLandmarker for single-person upper-body tracking. */
export async function loadPoseLandmarker(
	vision: VisionFileset,
): Promise<PoseLandmarker> {
	return PoseLandmarker.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath:
				"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
			delegate: "GPU",
		},
		runningMode: "VIDEO",
		numPoses: 1,
		outputSegmentationMasks: false,
	});
}

/** Creates a MediaPipe HandLandmarker configured for two-hand tracking. */
export async function loadHandLandmarker(
	vision: VisionFileset,
): Promise<HandLandmarker> {
	return HandLandmarker.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath:
				"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
			delegate: "GPU",
		},
		runningMode: "VIDEO",
		numHands: 2,
	});
}
