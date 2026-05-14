import { OneEuroFilter } from "./one-euro-filter";
import type { VRMExpressionManager } from "@pixiv/three-vrm";

/** Per-frame analyser state, created once by openMic and reused each frame. */
export interface AudioState {
	analyser: AnalyserNode;
	freqData: Float32Array<ArrayBuffer>;
	filters: Map<string, OneEuroFilter>;
	bandPeaks: [number, number, number, number];
	blendPeak: number;
}

/** Mouth-shape weights derived from mic audio, applied to the avatar each frame. */
export interface AudioVisemes {
	blend: number;
	aa: number;
	oh: number;
	ou: number;
	ee: number;
	ih: number;
	/** Band energies normalised to silence threshold, used by the debug overlay. */
	bands: [number, number, number, number];
}

/** Hermite smooth-step used to gate silence vs. speech. */
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Returns the RMS amplitude (linear) of an FFT band between loHz and hiHz. */
function bandAvg(
	data: Float32Array,
	loHz: number,
	hiHz: number,
	binHz: number,
): number {
	const lo = Math.max(0, Math.floor(loHz / binHz));
	const hi = Math.min(Math.floor(hiHz / binHz), data.length - 1);
	if (hi < lo) return 0;
	let sum = 0;
	for (let i = lo; i <= hi; i++) sum += Math.pow(10, data[i] / 20);
	return sum / (hi - lo + 1);
}

/**
 * Opens the default (or configured) microphone and wires it to a Web Audio
 * analyser node. Returns null if audio is disabled or access is denied.
 */
export async function openMic(
	audio: AppConfig["audio"],
): Promise<AudioState | null> {
	if (audio?.enabled === false) return null;
	try {
		let constraint: MediaTrackConstraints | boolean = true;
		if (audio?.deviceId)
			constraint = { deviceId: { exact: audio.deviceId } };
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: constraint,
			video: false,
		});
		const ctx = new AudioContext();
		const source = ctx.createMediaStreamSource(stream);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.6;
		source.connect(analyser);
		// Intentionally not connected to ctx.destination — no echo.
		return {
			analyser,
			freqData: new Float32Array(analyser.frequencyBinCount),
			filters: new Map(),
			bandPeaks: [0, 0, 0, 0],
			blendPeak: 0,
		};
	} catch (e) {
		console.warn("[audio] mic open failed:", e);
		return null;
	}
}

/**
 * Reads the current FFT frame and returns per-viseme mouth weights.
 * Uses a peak-hold envelope so values decay smoothly back to zero on silence.
 */
export function computeAudioVisemes(
	state: AudioState,
	cfg: AppConfig["audio"],
	now: number,
): AudioVisemes {
	state.analyser.getFloatFrequencyData(state.freqData);
	const binHz = state.analyser.context.sampleRate / state.analyser.fftSize;
	const d = state.freqData;

	// Four bands tuned to vocal formant regions (F1 / F2)
	const s = cfg?.sensitivity ?? 1;
	const decay = cfg?.bandDecay ?? 0.008;
	const p = state.bandPeaks;
	const bLow    = p[0] = Math.max(bandAvg(d,   80,  350, binHz) * s, p[0] - decay);
	const bMidLow = p[1] = Math.max(bandAvg(d,  350,  800, binHz) * s, p[1] - decay);
	const bMid    = p[2] = Math.max(bandAvg(d,  800, 1500, binHz) * s, p[2] - decay);
	const bMidHigh= p[3] = Math.max(bandAvg(d, 1500, 3000, binHz) * s, p[3] - decay);

	const rms = Math.sqrt(
		(bLow ** 2 + bMidLow ** 2 + bMid ** 2 + bMidHigh ** 2) / 4,
	);
	const threshold = cfg?.silenceThreshold ?? 0.015;
	const rawBlend =
		smoothstep(threshold, threshold * 4, rms) * (cfg?.blendWeight ?? 1);
	const blendDecay = cfg?.blendDecay ?? 0.04;
	const blend = (state.blendPeak = Math.max(
		rawBlend,
		state.blendPeak - blendDecay,
	));

	// Normalise bands to threshold scale so 1.0 = "clearly speaking"
	const tScale = 1 / (threshold * 4);
	const bands: [number, number, number, number] = [
		Math.min(1, bLow * tScale),
		Math.min(1, bMidLow * tScale),
		Math.min(1, bMid * tScale),
		Math.min(1, bMidHigh * tScale),
	];

	// Normalise against the "clearly speaking" level so viseme values are
	// proportional to absolute volume. Avoids the relative-peak trap where
	// the loudest band always maps to 1.0 even when all bands are tiny.
	const ref = threshold * 4;
	const { minCutoff = 6.0, beta = 0.3 } = cfg?.filter ?? {};
	const speaking = rawBlend > 0.001;
	const filt = (name: string, v: number): number => {
		if (!state.filters.has(name))
			state.filters.set(name, new OneEuroFilter(minCutoff, beta));
		const raw = Math.min(1, v / ref);
		// Always tick the filter to keep its state current for smooth decay on silence.
		const filtered = state.filters.get(name)!.filter(raw, now);
		return speaking ? raw : filtered;
	};

	return {
		blend,
		bands,
		aa: filt("aa", bMid),
		oh: filt("oh", bMidLow),
		ou: filt("ou", bLow),
		ee: filt("ee", bMidHigh * 1.1),
		ih: filt("ih", bMidHigh * 0.6 + bMidLow * 0.2),
	};
}

/**
 * Blends audio-derived viseme weights on top of the face-tracked mouth shapes.
 * Uses a soft overlay (20% blend per frame) so face tracking and audio don't fight.
 */
export function applyAudioBlend(
	em: VRMExpressionManager,
	v: AudioVisemes,
): void {
	const over = (name: string, target: number): void => {
		const cur = em.getValue(name);
		if (cur === null) return;
		em.setValue(name, Math.max(0, Math.min(1, cur + (target - cur) * 0.2)));
	};
	over("aa", v.aa);
	over("oh", v.oh);
	over("ou", v.ou);
	over("ee", v.ee);
	over("ih", v.ih);
}
