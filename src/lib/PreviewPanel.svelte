<script lang="ts">
	// Side panel (full screen on phones or on demand) with one tab per opened file.
	import FileView from './FileView.svelte';
	import { fileUrl } from './parts.js';
	import { builtinKind } from './previewers.js';
	import type { ChatLabels, FilePart } from './types.js';

	type Props = { files: FilePart[]; active: number; labels: ChatLabels; htmlSandbox?: string; onselect: (i: number) => void; onclosetab: (i: number) => void; onclose: () => void };
	let { files, active, labels, htmlSandbox, onselect, onclosetab, onclose }: Props = $props();

	let full = $state(false);
	let zoom = $state(1);
	let version = $state<Record<string, number>>({});
	let text = $state<string | null>(null);
	let copied = $state(false);
	let panel = $state<HTMLElement>();

	const file = $derived(files[active]);
	const vi = $derived(file ? (version[file.id] ?? (file.versions?.length ?? 1) - 1) : 0);
	const shown = $derived.by((): FilePart | undefined => {
		const v = file?.versions?.[vi];
		return v && file ? { ...file, url: v.url, blob: v.blob } : file;
	});
	const url = $derived(shown ? fileUrl(shown) : '');
	const kind = $derived(file ? builtinKind(file) : 'download');
	$effect(() => {
		void url;
		zoom = 1;
		text = null;
	});
	$effect(() => panel?.focus());

	async function copy() {
		if (text == null) return;
		await navigator.clipboard?.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
	function tabKey(e: KeyboardEvent, i: number) {
		const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!d) return;
		const n = (i + d + files.length) % files.length;
		onselect(n);
		(e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role=tab]')[n]?.focus();
	}
</script>

{#if file && shown}
	<div class="cu-panel" class:cu-full={full} role="dialog" aria-label={labels.preview} tabindex="-1" bind:this={panel} onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), onclose())}>
		<div class="cu-tabs" role="tablist">
			{#each files as f, i (f.id)}
				<div class="cu-tab" class:cu-on={i === active}>
					<button type="button" role="tab" aria-selected={i === active} tabindex={i === active ? 0 : -1} onclick={() => onselect(i)} onkeydown={(e) => tabKey(e, i)}>{f.name}</button>
					<button type="button" class="cu-btn" aria-label="{labels.close} {f.name}" onclick={() => onclosetab(i)}>×</button>
				</div>
			{/each}
		</div>
		<div class="cu-panel-bar">
			{#if file.versions && file.versions.length > 1}
				<label>
					<span class="cu-sr">{labels.version}</span>
					<select value={vi} onchange={(e) => (version[file.id] = Number((e.currentTarget as HTMLSelectElement).value))}>
						{#each file.versions as v, i (i)}<option value={i}>{v.label}</option>{/each}
					</select>
				</label>
			{/if}
			{#if kind === 'image' || kind === 'svg'}
				<button type="button" class="cu-btn" aria-label={labels.zoomOut} onclick={() => (zoom = Math.max(0.25, zoom / 1.25))}>−</button>
				<output aria-live="polite">{Math.round(zoom * 100)}%</output>
				<button type="button" class="cu-btn" aria-label={labels.zoomIn} onclick={() => (zoom = Math.min(8, zoom * 1.25))}>+</button>
			{/if}
			<span class="cu-grow"></span>
			{#if text != null}<button type="button" class="cu-btn" onclick={copy}>{copied ? labels.copied : labels.copy}</button>{/if}
			<a class="cu-btn" href={url} download={file.name}>{labels.download}</a>
			<button type="button" class="cu-btn" aria-pressed={full} onclick={() => (full = !full)}>{labels.fullscreen}</button>
			<button type="button" class="cu-btn" aria-label={labels.close} onclick={onclose}>×</button>
		</div>
		<div class="cu-panel-body" role="tabpanel" aria-label={file.name}>
			{#key url}
				<FileView file={shown} {url} {labels} {zoom} {htmlSandbox} ontext={(t) => (text = t)} />
			{/key}
		</div>
	</div>
{/if}
