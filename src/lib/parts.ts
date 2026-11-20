// The message parts schema at runtime: checks parts coming from a model (untrusted JSON), validates answers, formats them.
import type { AskPart, AskStep, FilePart, MessagePart } from './types.js';

const KINDS = ['choice', 'text', 'number', 'slider', 'rating', 'date', 'file', 'confirm'];
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Returns the reason a value is not a valid MessagePart, or null if it is. Use it on parts parsed from model output. */
export function partError(p: unknown): string | null {
	if (!p || typeof p !== 'object') return 'not an object';
	const o = p as Record<string, unknown>;
	if (o.type === 'text') return typeof o.text === 'string' ? null : 'text: missing text';
	if (o.type === 'file') {
		if (!str(o.id) || !str(o.name) || !str(o.mime)) return 'file: id, name and mime are required';
		return str(o.url) || o.blob instanceof Blob ? null : 'file: url or blob is required';
	}
	if (o.type === 'tool') {
		if (!str(o.id) || !str(o.name)) return 'tool: id and name are required';
		return ['running', 'done', 'error'].includes(o.status as string) ? null : 'tool: status must be running, done or error';
	}
	if (o.type === 'ask') {
		if (!str(o.id)) return 'ask: id is required';
		if (!Array.isArray(o.steps) || !o.steps.length) return 'ask: steps must be a non-empty array';
		const ids = new Set<string>();
		for (const s of o.steps as Record<string, unknown>[]) {
			if (!s || !str(s.id) || !str(s.prompt)) return 'ask: each step needs id and prompt';
			if (ids.has(s.id)) return `ask: duplicate step id ${s.id}`;
			ids.add(s.id);
			if (!KINDS.includes(s.kind as string)) return `ask: unknown kind ${String(s.kind)}`;
			if (s.kind === 'choice' && !(Array.isArray(s.options) && s.options.length && s.options.every((x) => x && str(x.value) && typeof x.label === 'string')))
				return `ask: step ${s.id} needs options [{ value, label }]`;
			if (s.kind === 'slider' && !(typeof s.min === 'number' && typeof s.max === 'number' && s.min < s.max)) return `ask: step ${s.id} needs min < max`;
		}
		return null;
	}
	return `unknown type ${String(o.type)}`;
}

export const isMessagePart = (p: unknown): p is MessagePart => partError(p) === null;

const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** Validates one step's value. Returns 'required', 'invalid' (both keys of ChatLabels) or null. */
export function validateStep(s: AskStep, v: unknown): 'required' | 'invalid' | null {
	if (empty(v)) return s.required ? 'required' : null;
	switch (s.kind) {
		case 'choice': {
			const vals = s.multiple ? (Array.isArray(v) ? v : null) : [v];
			if (!vals || !vals.every((x) => s.options.some((o) => o.value === x))) return 'invalid';
			if (s.multiple && ((s.min != null && vals.length < s.min) || (s.max != null && vals.length > s.max))) return 'invalid';
			return null;
		}
		case 'text': {
			if (typeof v !== 'string') return 'invalid';
			if ((s.minLength != null && v.length < s.minLength) || (s.maxLength != null && v.length > s.maxLength)) return 'invalid';
			// ponytail: a pattern that does not compile is ignored rather than blocking the user.
			try {
				if (s.pattern && !new RegExp(`^(?:${s.pattern})$`).test(v)) return 'invalid';
			} catch {}
			return null;
		}
		case 'number':
		case 'slider':
		case 'rating': {
			const max = s.kind === 'rating' ? (s.max ?? 5) : s.max;
			const min = s.kind === 'rating' ? 1 : s.min;
			if (typeof v !== 'number' || Number.isNaN(v)) return 'invalid';
			return (min != null && v < min) || (max != null && v > max) ? 'invalid' : null;
		}
		case 'date':
			if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'invalid';
			return (s.min && v < s.min) || (s.max && v > s.max) ? 'invalid' : null;
		case 'file':
			return Array.isArray(v) && v.every((f) => f instanceof File) ? null : 'invalid';
		case 'confirm':
			return typeof v === 'boolean' ? null : 'invalid';
	}
}

/** True/false for a quiz step with `correct`, else null. */
export function isCorrect(s: AskStep, v: unknown): boolean | null {
	if (s.kind !== 'choice' || s.correct == null) return null;
	const want = [s.correct].flat().sort();
	const got = [v].flat().sort();
	return want.length === got.length && want.every((x, i) => x === got[i]);
}

function stepText(s: AskStep, v: unknown, yes = 'Yes', no = 'No'): string {
	if (empty(v)) return '—';
	if (s.kind === 'choice') return [v].flat().map((x) => s.options.find((o) => o.value === x)?.label ?? String(x)).join(', ');
	if (s.kind === 'file') return (v as File[]).map((f) => f.name).join(', ');
	if (s.kind === 'confirm') return v ? yes : no;
	if (s.kind === 'rating') return `${'★'.repeat(v as number)} (${v}/${s.max ?? 5})`;
	return String(v);
}

/** The answer as the plain text shown in the user's reply bubble (and handy to send to the model). */
export function formatAnswer(part: AskPart, value: unknown, labels?: { yes?: string; no?: string }): string {
	if (part.steps.length === 1) return stepText(part.steps[0], value, labels?.yes, labels?.no);
	const rec = (value ?? {}) as Record<string, unknown>;
	return part.steps.map((s) => `${s.prompt} ${stepText(s, rec[s.id], labels?.yes, labels?.no)}`).join('\n');
}

/** The URL to show for a file part (object URLs for blobs are cached per Blob). */
const urls = new WeakMap<Blob, string>();
export function fileUrl(f: Pick<FilePart, 'url' | 'blob'>): string {
	if (f.url) return f.url;
	if (!f.blob || typeof document === 'undefined') return ''; // no object URLs during SSR
	let u = urls.get(f.blob);
	if (!u) urls.set(f.blob, (u = URL.createObjectURL(f.blob)));
	return u;
}

/** Turns a File (attached by the user) into a FilePart for the preview panel. */
export const fileToPart = (f: File, id = `${f.name}-${f.size}-${f.lastModified}`): FilePart => ({
	type: 'file',
	id,
	name: f.name,
	mime: f.type || 'application/octet-stream',
	blob: f,
	size: f.size
});
