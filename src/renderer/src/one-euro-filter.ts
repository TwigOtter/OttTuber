/**
 * One-euro filter: adaptive low-pass filter for smoothing noisy real-time signals.
 * Reduces lag during fast motion while suppressing jitter at rest.
 * Vendored from https://gery.casiez.net/1euro/
 */
export class OneEuroFilter {
	minCutoff: number;
	private beta: number;
	private dCutoff: number;
	private x: number | null = null;
	private dx = 0;
	private t: number | null = null;

	/**
	 * @param minCutoff - Minimum cutoff frequency; lower = smoother at rest.
	 * @param beta - Speed coefficient; higher = less lag during fast motion.
	 * @param dCutoff - Derivative cutoff frequency.
	 */
	constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
		this.minCutoff = minCutoff;
		this.beta = beta;
		this.dCutoff = dCutoff;
	}

	/** Computes the smoothing factor alpha for a given cutoff frequency and timestep. */
	private alpha(cutoff: number, dt: number): number {
		const r = 2 * Math.PI * cutoff * dt;
		return r / (r + 1);
	}

	/** Returns the filtered value for a new raw sample at the given timestamp (ms). */
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
