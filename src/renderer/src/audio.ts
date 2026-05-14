/** Per-frame analyser state, created once by openMic and reused each frame. */
export interface AudioState {
	analyser: AnalyserNode;
	timeDomainData: Float32Array<ArrayBuffer>;
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
		analyser.fftSize = 1024;
		source.connect(analyser);
		// Intentionally not connected to ctx.destination — no echo.
		return {
			analyser,
			timeDomainData: new Float32Array(
				analyser.fftSize,
			) as Float32Array<ArrayBuffer>,
		};
	} catch (e) {
		console.warn("[audio] mic open failed:", e);
		return null;
	}
}

/**
 * Returns the current RMS amplitude of the microphone signal in the range [0, 1].
 * Uses time-domain samples so the result reflects instantaneous loudness rather
 * than spectral energy, which is what we want for mouth-filter modulation.
 */
export function getMicAmplitude(state: AudioState): number {
	state.analyser.getFloatTimeDomainData(state.timeDomainData);
	let sum = 0;
	for (let i = 0; i < state.timeDomainData.length; i++) {
		sum += state.timeDomainData[i] * state.timeDomainData[i];
	}
	return Math.sqrt(sum / state.timeDomainData.length);
}
