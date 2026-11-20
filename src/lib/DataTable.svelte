<script lang="ts">
	import { filterRows, sortRows } from './table.js';

	let { head, rows, labels }: { head: string[]; rows: string[][]; labels: { filter: string; sortBy: string } } = $props();
	let q = $state('');
	let col = $state(-1);
	let dir = $state<'asc' | 'desc'>('asc');
	const shown = $derived.by(() => {
		const f = filterRows(rows, q);
		return col < 0 ? f : sortRows(f, col, dir);
	});
	const sort = (i: number) => {
		dir = col === i && dir === 'asc' ? 'desc' : 'asc';
		col = i;
	};
</script>

<div class="cu-dt">
	<input type="search" class="cu-filter" placeholder="{labels.filter}…" aria-label={labels.filter} bind:value={q} />
	<div class="cu-dt-scroll">
		<table>
			<thead>
				<tr>
					{#each head as h, i (i)}
						<th aria-sort={col === i ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
							<button type="button" class="cu-sort" aria-label="{labels.sortBy} {h}" onclick={() => sort(i)}>{h}</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each shown.slice(0, 1000) as r, i (i)}
					<tr>{#each head as _, j (j)}<td>{r[j] ?? ''}</td>{/each}</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<!-- ponytail: first 1000 rows rendered; virtualise if huge CSVs become common. -->
	<p class="cu-dt-count" aria-live="polite">{shown.length} / {rows.length}</p>
</div>
