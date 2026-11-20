<script lang="ts">
	// Sanitized Markdown plus post-render enhancements: block renderers, sortable/filterable tables and lists, SVG motion.
	import { pauseSvgAnimations, renderBlocks } from './blocks.js';
	import { enhanceList, enhanceTable } from './table.js';

	let { html, labels }: { html: string; labels: { filter: string; sortBy: string } } = $props();
	let el = $state<HTMLElement>();

	$effect(() => {
		void html;
		if (!el) return;
		for (const t of el.querySelectorAll('table')) enhanceTable(t, labels);
		for (const l of el.querySelectorAll<HTMLUListElement>(':scope > ul, :scope > ol')) enhanceList(l, labels);
		pauseSvgAnimations(el);
		void renderBlocks(el);
	});
</script>

<div class="cu-md" bind:this={el}>{@html html}</div>
