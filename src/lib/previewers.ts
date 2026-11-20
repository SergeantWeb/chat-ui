// Previewer registry: integrators map a MIME type ('model/gltf-binary'), a MIME family ('image/*') or an extension ('.glb')
// to a Svelte component that receives { file: FilePart, url: string }. Registered previewers win over the built-in ones.
import type { Component } from 'svelte';
import type { FilePart } from './types.js';

export type PreviewerProps = { file: FilePart; url: string };
export type Previewer = Component<PreviewerProps> | { load: () => Promise<{ default: Component<PreviewerProps> }> };

const registry = new Map<string, Previewer>();

/** Registers a previewer. Pass a component, or `{ load: () => import('./Glb.svelte') }` to keep it out of the base bundle.
 *  Returns a function that unregisters it. */
export function registerPreviewer(key: string, previewer: Previewer): () => void {
	const k = key.toLowerCase();
	registry.set(k, previewer);
	return () => registry.get(k) === previewer && registry.delete(k);
}

export const extOf = (name: string) => (/\.[^./]+$/.exec(name.toLowerCase())?.[0] ?? '');

/** Most specific match first: exact MIME, extension, MIME family, '*'. */
export function findPreviewer(file: Pick<FilePart, 'name' | 'mime'>): Previewer | undefined {
	const mime = file.mime.toLowerCase().split(';')[0].trim();
	return registry.get(mime) ?? registry.get(extOf(file.name)) ?? registry.get(mime.split('/')[0] + '/*') ?? registry.get('*');
}

export type BuiltinKind = 'image' | 'svg' | 'video' | 'audio' | 'pdf' | 'html' | 'markdown' | 'csv' | 'json' | 'text' | 'download';

const TEXT_EXT = /\.(txt|log|md|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sh|sql|yaml|yml|toml|ini|xml|css|scss|svelte|vue|html?)$/;

/** Which built-in view a file gets when no previewer is registered. */
export function builtinKind(file: Pick<FilePart, 'name' | 'mime'>): BuiltinKind {
	const m = file.mime.toLowerCase();
	const e = extOf(file.name);
	if (m === 'image/svg+xml' || e === '.svg') return 'svg';
	if (m.startsWith('image/')) return 'image';
	if (m.startsWith('video/')) return 'video';
	if (m.startsWith('audio/')) return 'audio';
	if (m === 'application/pdf' || e === '.pdf') return 'pdf';
	if (m === 'text/html' || e === '.html' || e === '.htm') return 'html';
	if (m === 'text/markdown' || e === '.md') return 'markdown';
	if (m === 'text/csv' || e === '.csv' || e === '.tsv') return 'csv';
	if (m === 'application/json' || e === '.json') return 'json';
	if (m.startsWith('text/') || /json|xml|javascript|typescript|yaml/.test(m) || TEXT_EXT.test(e)) return 'text';
	return 'download';
}

/** Resolves a previewer (loading it if lazy) to a component. */
export const loadPreviewer = async (p: Previewer): Promise<Component<PreviewerProps>> => ('load' in p ? (await p.load()).default : p);
