<script lang="ts">
	// Shows one file: a registered previewer if any, else a built-in view by type. Used inline (compact) and in the panel.
	import DataTable from './DataTable.svelte';
	import { highlight, loadHighlighter, renderMarkdown } from './markdown.js';
	import { builtinKind, extOf, findPreviewer, loadPreviewer } from './previewers.js';
	import { parseCSV } from './table.js';
	import type { ChatLabels, FilePart } from './types.js';

	type Props = { file: FilePart; url: string; labels: ChatLabels; zoom?: number; htmlSandbox?: string; inline?: boolean; ontext?: (t: string) => void };
	let { file, url, labels, zoom = 1, htmlSandbox = '', inline = false, ontext }: Props = $props();

	const custom = $derived(findPreviewer(file));
	const kind = $derived(builtinKind(file));
	const needsText = $derived(['html', 'markdown', 'csv', 'json', 'text'].includes(kind));
	let text = $state<string | null>(null);
	let failed = $state(false);
	let hl = $state(0);

	$effect(() => {
		if (custom || !needsText || !url) return;
		let live = true;
		text = null;
		failed = false;
		fetch(url)
			.then((r) => r.text())
			.then((t) => live && ((text = t), ontext?.(t)))
			.catch(() => live && (failed = true));
		if (kind === 'text' || kind === 'json') loadHighlighter().then(() => hl++);
		return () => (live = false);
	});

	const lang = $derived(kind === 'json' ? 'json' : extOf(file.name).slice(1));
	const code = $derived.by(() => {
		void hl;
		return text == null ? '' : highlight(kind === 'json' ? pretty(text) : text, lang);
	});
	function pretty(t: string) {
		try {
			return JSON.stringify(JSON.parse(t), null, 2);
		} catch {
			return t;
		}
	}
	// JSON arrays of flat objects get the table view.
	const table = $derived.by((): { head: string[]; rows: string[][] } | null => {
		if (text == null) return null;
		if (kind === 'csv') {
			const [head = [], ...rows] = parseCSV(text.trim());
			return { head, rows };
		}
		if (kind !== 'json') return null;
		try {
			const v = JSON.parse(text);
			if (!Array.isArray(v) || !v.length || !v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return null;
			const head = [...new Set(v.flatMap((x) => Object.keys(x)))];
			return { head, rows: v.map((x) => head.map((h) => (x[h] == null ? '' : typeof x[h] === 'object' ? JSON.stringify(x[h]) : String(x[h])))) };
		} catch {
			return null;
		}
	});
	const size = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
</script>

<div class="cu-fv cu-fv-{kind}" class:cu-fv-inline={inline}>
	{#if custom}
		{#await loadPreviewer(custom) then C}
			<C {file} {url} />
		{/await}
	{:else if kind === 'image' || kind === 'svg'}
		<!-- SVG through <img>: scripts inside never run. -->
		<div class="cu-fv-zoom"><img src={url} alt={file.name} style:transform="scale({zoom})" /></div>
	{:else if kind === 'video'}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video src={url} controls preload="metadata"></video>
	{:else if kind === 'audio'}
		<audio src={url} controls preload="metadata"></audio>
	{:else if kind === 'pdf'}
		<iframe src={url} title={file.name}></iframe>
	{:else if kind === 'download' || failed}
		<div class="cu-fv-card">
			<span class="cu-fv-ext" aria-hidden="true">{extOf(file.name).slice(1).toUpperCase() || 'FILE'}</span>
			<span>{file.name}<small>{file.mime} {size(file.size)}</small></span>
			<a class="cu-btn" href={url} download={file.name}>{labels.download}</a>
		</div>
	{:else if text == null}
		<p class="cu-fv-loading">…</p>
	{:else if kind === 'html'}
		<!-- Sandboxed: no scripts, no same-origin access unless the integrator widens htmlSandbox. -->
		<iframe sandbox={htmlSandbox} srcdoc={text} title={file.name}></iframe>
	{:else if kind === 'markdown'}
		<div class="cu-md">{@html renderMarkdown(text)}</div>
	{:else if table}
		<DataTable head={table.head} rows={table.rows} {labels} />
	{:else}
		<pre class="cu-fv-code"><code class="hljs">{@html code}</code></pre>
	{/if}
</div>
