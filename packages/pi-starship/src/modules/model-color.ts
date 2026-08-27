/**
 * Deterministic model colors: the model series (id without date/latest suffixes)
 * selects a stable hue so every model in a family shares a main color, while the
 * full id hash nudges saturation and lightness so distinct models differ slightly.
 */

const DATE_SUFFIX = /-\d{8}$/u;
const LATEST_SUFFIX = /-latest$/u;

export function seriesOf(modelId: string): string {
	return modelId.replace(DATE_SUFFIX, "").replace(LATEST_SUFFIX, "");
}

export function fnv1a(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function modelColorHex(modelId: string): string {
	const idHash = fnv1a(modelId);
	const saturation = 0.55 + ((idHash % 17) - 8) / 100;
	const lightness = 0.5 + (((idHash >>> 8) % 13) - 6) / 100;
	return hslToHex(modelHue(modelId), saturation, lightness);
}

export function modelHue(modelId: string): number {
	return fnv1a(seriesOf(modelId)) % 360;
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const sector = (((hue % 360) + 360) % 360) / 60;
	const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
	const [red, green, blue] = colorComponents(sector, chroma, intermediate);
	const match = lightness - chroma / 2;
	return `#${hexByte(red + match)}${hexByte(green + match)}${hexByte(blue + match)}`;
}

function colorComponents(
	sector: number,
	chroma: number,
	intermediate: number,
): [number, number, number] {
	if (sector < 1) return [chroma, intermediate, 0];
	if (sector < 2) return [intermediate, chroma, 0];
	if (sector < 3) return [0, chroma, intermediate];
	if (sector < 4) return [0, intermediate, chroma];
	if (sector < 5) return [intermediate, 0, chroma];
	return [chroma, 0, intermediate];
}

function hexByte(value: number): string {
	const clamped = Math.max(0, Math.min(255, Math.round(value * 255)));
	return clamped.toString(16).padStart(2, "0");
}
