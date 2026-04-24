// ---------------------------------------------------------------------------
// Types (mirrors env.d.ts — duplicated here so this file is self-contained
// without a reference to vite/client, which doesn't apply in the debug window)
// ---------------------------------------------------------------------------

interface DebugBlendshape {
	name: string;
	value: number;
}
interface DebugHead {
	pitch: number;
	yaw: number;
	roll: number;
}
interface DebugData {
	detected: boolean;
	blendshapes: DebugBlendshape[];
	head: DebugHead;
}

// ---------------------------------------------------------------------------
// Build the static chrome (header + two section containers)
// ---------------------------------------------------------------------------

const style = document.createElement("style");
style.textContent = `
  body { display: flex; flex-direction: column; height: 100vh; }

  #header {
    padding: 8px 12px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  #header h1 { font-size: 13px; font-weight: 600; color: #e6edf3; }
  #status {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #21262d;
    color: #8b949e;
  }
  #status.detected { background: #0f2a1a; color: #3fb950; }

  #shortcut {
    margin-left: auto;
    font-size: 10px;
    color: #484f58;
  }

  #scrollContainer {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
    scrollbar-width: thin;
    scrollbar-color: #30363d #0d1117;
  }

  .section-label {
    padding: 4px 12px 2px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #484f58;
  }

  .row {
    display: flex;
    align-items: center;
    padding: 2px 12px;
    gap: 8px;
    height: 22px;
  }
  .row:hover { background: #161b22; }

  .name {
    width: 148px;
    flex-shrink: 0;
    color: #8b949e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- bar track ---- */
  .track {
    position: relative;
    flex: 1;
    height: 6px;
    background: #21262d;
    border-radius: 3px;
    overflow: hidden;
  }

  /* center marker for head rotation rows */
  .track.centered::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    width: 1px;
    height: 100%;
    background: #30363d;
  }

  .bar {
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: 3px;
    background: #58a6ff;
    transition: none;
  }

  /* head rotation bar uses an orange tint to distinguish it */
  .bar.head { background: #f0883e; }

  .val {
    width: 52px;
    flex-shrink: 0;
    text-align: right;
    color: #e6edf3;
    font-variant-numeric: tabular-nums;
  }
`;
document.head.appendChild(style);

const header = document.createElement("div");
header.id = "header";
header.innerHTML = `
  <h1>OttTuber Debug</h1>
  <span id="status">waiting…</span>
  <span id="shortcut">Ctrl+Shift+D to toggle</span>
`;
document.body.appendChild(header);

const scrollContainer = document.createElement("div");
scrollContainer.id = "scrollContainer";
document.body.appendChild(scrollContainer);

const statusEl = document.getElementById("status")!;

// ---------------------------------------------------------------------------
// Row cache — create DOM nodes once, update values each frame
// ---------------------------------------------------------------------------

interface RowElements {
	bar: HTMLDivElement;
	val: HTMLSpanElement;
}

const rowCache = new Map<string, RowElements>();

function getOrCreateRow(
	container: HTMLElement,
	key: string,
	isHead: boolean,
): RowElements {
	if (rowCache.has(key)) return rowCache.get(key)!;

	const row = document.createElement("div");
	row.className = "row";

	const name = document.createElement("span");
	name.className = "name";
	name.textContent = key;
	name.title = key;

	const track = document.createElement("div");
	track.className = isHead ? "track centered" : "track";

	const bar = document.createElement("div");
	bar.className = isHead ? "bar head" : "bar";
	track.appendChild(bar);

	const val = document.createElement("span");
	val.className = "val";

	row.append(name, track, val);
	container.appendChild(row);

	const els = { bar, val };
	rowCache.set(key, els);
	return els;
}

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------

/** Blendshape bar: 0 → 1, left-anchored */
function updateBlendshapeRow(
	container: HTMLElement,
	name: string,
	value: number,
): void {
	const { bar, val } = getOrCreateRow(container, name, false);
	bar.style.left = "0";
	bar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
	bar.style.right = "";
	val.textContent = value.toFixed(3);
}

/** Head rotation bar: –90° → +90°, centred at 50% */
function updateHeadRow(
	container: HTMLElement,
	label: string,
	degrees: number,
): void {
	const { bar, val } = getOrCreateRow(container, label, true);
	const norm = Math.max(-1, Math.min(1, degrees / 90));
	if (norm >= 0) {
		bar.style.left = "50%";
		bar.style.width = `${norm * 50}%`;
		bar.style.right = "";
	} else {
		bar.style.right = "50%";
		bar.style.width = `${-norm * 50}%`;
		bar.style.left = "";
	}
	val.textContent = `${degrees >= 0 ? "+" : ""}${degrees.toFixed(1)}°`;
}

function addSectionLabel(container: HTMLElement, text: string): void {
	const el = document.createElement("div");
	el.className = "section-label";
	el.textContent = text;
	container.appendChild(el);
}

// ---------------------------------------------------------------------------
// Section containers (created lazily on first data, then reused)
// ---------------------------------------------------------------------------

let headSection: HTMLElement | null = null;
let bsSection: HTMLElement | null = null;

function ensureSections(hasHead: boolean, hasBlendshapes: boolean): void {
	if (hasHead && !headSection) {
		addSectionLabel(scrollContainer, "Head Rotation");
		headSection = document.createElement("div");
		scrollContainer.appendChild(headSection);
	}
	if (hasBlendshapes && !bsSection) {
		addSectionLabel(scrollContainer, "Blendshapes");
		bsSection = document.createElement("div");
		scrollContainer.appendChild(bsSection);
	}
}

// ---------------------------------------------------------------------------
// Receive data from the main process (relayed from the renderer)
// ---------------------------------------------------------------------------

window.electron.onDebugData((data: DebugData) => {
	// Update detection status badge
	if (data.detected) {
		statusEl.textContent = "tracking";
		statusEl.className = "detected";
	} else {
		statusEl.textContent = "no face";
		statusEl.className = "";
	}

	const hasHead =
		data.head.pitch !== 0 || data.head.yaw !== 0 || data.head.roll !== 0;
	ensureSections(hasHead, data.blendshapes.length > 0);

	if (headSection) {
		updateHeadRow(headSection, "pitch", data.head.pitch);
		updateHeadRow(headSection, "yaw", data.head.yaw);
		updateHeadRow(headSection, "roll", data.head.roll);
	}

	if (bsSection) {
		for (const bs of data.blendshapes) {
			updateBlendshapeRow(bsSection, bs.name, bs.value);
		}
	}
});
