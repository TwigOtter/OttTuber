/// <reference types="vite/client" />

interface AppConfig {
	camera: {
		position: [number, number, number];
		lookAt: [number, number, number];
		fov: number;
	};
	webcam?: {
		deviceLabel?: string | null;
		deviceId?: string | null;
	};
	audio?: {
		enabled?: boolean;
		deviceId?: string | null;
	};
	model: {
		path: string;
		scale: number;
		rotation: [number, number, number];
		mirror: boolean;
	};
	tracking: {
		blendshapeAmplify: Record<string, number>;
		blendshapeFilter: { minCutoff: number; beta: number };
		blendshapeFilterOverrides: Record<
			string,
			{ minCutoff: number; beta: number }
		>;
		headFilter: { minCutoff: number; beta: number };
		armCalibration?: {
			poseScale?: { x: number; y: number; z: number };
			minCutoff?: number;
			beta?: number;
		};
		handFilter?: { minCutoff?: number; beta?: number };
		/** Dynamic mouth-filter modulation driven by mic amplitude. */
		mouthFilter?: {
			/** minCutoff used when silent (defaults to blendshapeFilter.minCutoff). */
			minCutoffSilent?: number;
			/** minCutoff used at peak amplitude — higher = more responsive when talking. */
			minCutoffTalking?: number;
			/** RMS amplitude below which the mic is treated as silent. */
			noiseFloor?: number;
			/** Multiplier applied to raw mouth scores: value *= 1 + amplitude * scale. Default 10. */
			amplitudeScale?: number;
		};
	};
}

interface DebugData {
	detected: boolean;
	blendshapes: Array<{ name: string; value: number }>;
	head: { pitch: number; yaw: number; roll: number };
	arms: Array<{ name: string; value: number }>;
	audio?: Array<{ name: string; value: number }>;
}

interface Window {
	electron: {
		loadVrm(filename: string): Promise<ArrayBuffer>;
		loadConfig(): Promise<AppConfig | null>;
		sendDebugData(data: DebugData): void;
		onDebugData(callback: (data: DebugData) => void): void;
	};
}
