// Client-side sort/filter for tables and lists: pure functions plus a DOM enhancer for rendered Markdown.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const num = (s: string) => {
	const t = s.replace(/[\s,%€$£]/g, '');
	return t !== '' && !Number.isNaN(Number(t)) ? Number(t) : null;
};

/** Compares two cells: numbers numerically (1 000, 12%, $5 work), else text with a natural, case-insensitive order. */
export function compareCells(a: string, b: string): number {
	const x = num(a);
	const y = num(b);
	return x != null && y != null ? x - y : collator.compare(a, b);
}

/** Stable sort of rows by a column. */
export const sortRows = <T extends string[]>(rows: T[], col: number, dir: 'asc' | 'desc' = 'asc'): T[] =>
	rows
		.map((r, i) => [r, i] as const)
		.sort(([a, i], [b, j]) => (dir === 'asc' ? 1 : -1) * compareCells(a[col] ?? '', b[col] ?? '') || i - j)
		.map(([r]) => r);

/** Rows where any cell contains every word of the query (case-insensitive). */
export function filterRows<T extends string[]>(rows: T[], query: string): T[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return words.length ? rows.filter((r) => words.every((w) => r.some((c) => c.toLowerCase().includes(w)))) : rows;
}

/** Parses CSV/TSV text (quoted fields, escaped quotes, newlines in quotes). */
export function parseCSV(text: string, sep = text.split('\n')[0].includes('\t') ? '\t' : ','): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
			else if (c === '"') q = false;
			else cell += c;
		} else if (c === '"') q = true;
		else if (c === sep) row.push(cell), (cell = '');
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cell), rows.push(row), (row = []), (cell = '');
		} else cell += c;
	}
	if (cell || row.length) row.push(cell), rows.push(row);
	return rows;
}

let uid = 0;

/** Adds a filter box and sortable headers to a rendered <table>, and a filter + A-Z toggle to long lists. Idempotent. */
export function enhanceTable(table: HTMLTableElement, labels: { filter: string; sortBy: string }) {
	if (table.dataset.cuEnhanced) return;
	table.dataset.cuEnhanced = '1';
	const body = table.tBodies[0];
	if (!body || body.rows.length < 2) return;
	const rows = [...body.rows];
	const cells = (tr: HTMLTableRowElement) => [...tr.cells].map((c) => c.textContent ?? '');
	const input = filterBox(labels.filter, (q) => {
		const keep = new Set(filterRows(rows.map((r) => Object.assign(cells(r), { tr: r })), q).map((r) => r.tr));
		for (const r of rows) r.hidden = !keep.has(r);
	});
	table.before(input);
	[...(table.tHead?.rows[0]?.cells ?? [])].forEach((th, col) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'cu-sort';
		btn.textContent = th.textContent;
		btn.setAttribute('aria-label', `${labels.sortBy} ${th.textContent}`);
		th.textContent = '';
		th.append(btn);
		btn.onclick = () => {
			const dir = th.getAttribute('aria-sort') === 'ascending' ? 'desc' : 'asc';
			for (const h of table.tHead!.rows[0].cells) h.removeAttribute('aria-sort');
			th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
			const sorted = sortRows(rows.map((r) => Object.assign(cells(r), { tr: r })), col, dir);
			body.append(...sorted.map((r) => r.tr));
		};
	});
}

export function enhanceList(list: HTMLUListElement | HTMLOListElement, labels: { filter: string; sortBy: string }) {
	if (list.dataset.cuEnhanced || list.children.length < 6 || list.querySelector('input[type=checkbox]')) return;
	list.dataset.cuEnhanced = '1';
	const items = [...list.children] as HTMLElement[];
	const bar = document.createElement('div');
	bar.className = 'cu-tools';
	bar.append(
		filterBox(labels.filter, (q) => {
			const keep = new Set(filterRows(items.map((li) => Object.assign([li.textContent ?? ''], { li })), q).map((r) => r.li));
			for (const li of items) li.hidden = !keep.has(li);
		})
	);
	if (list.tagName === 'UL') {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'cu-btn';
		btn.textContent = 'A→Z';
		btn.setAttribute('aria-pressed', 'false');
		btn.setAttribute('aria-label', `${labels.sortBy} A-Z`);
		btn.onclick = () => {
			const on = btn.getAttribute('aria-pressed') !== 'true';
			btn.setAttribute('aria-pressed', String(on));
			list.append(...(on ? sortRows(items.map((li) => Object.assign([li.textContent ?? ''], { li })), 0).map((r) => r.li) : items));
		};
		bar.append(btn);
	}
	list.before(bar);
}

function filterBox(label: string, onInput: (q: string) => void) {
	const input = document.createElement('input');
	input.type = 'search';
	input.className = 'cu-filter';
	input.placeholder = label + '…';
	input.setAttribute('aria-label', label);
	input.id = `cu-f${++uid}`;
	input.oninput = () => onInput(input.value);
	return input;
}
