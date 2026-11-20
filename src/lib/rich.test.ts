import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Chat from './Chat.svelte';
import { renderMarkdown } from './markdown.js';
import { formatAnswer, isCorrect, partError, validateStep } from './parts.js';
import { builtinKind, findPreviewer, registerPreviewer } from './previewers.js';
import { enhanceTable, filterRows, parseCSV, sortRows } from './table.js';
import { branch, searchMessages, switchVersion, toMarkdown } from './thread.js';
import type { AskPart, ChatMessage } from './types.js';

Element.prototype.scrollTo = () => {};
afterEach(cleanup);

describe('parts schema', () => {
	it('accepts valid parts and explains invalid ones', () => {
		expect(partError({ type: 'text', text: 'hi' })).toBeNull();
		expect(partError({ type: 'file', id: 'f', name: 'a.png', mime: 'image/png', url: 'blob:x' })).toBeNull();
		expect(partError({ type: 'file', id: 'f', name: 'a.png', mime: 'image/png' })).toMatch(/url or blob/);
		expect(partError({ type: 'tool', id: 't', name: 'search', status: 'running' })).toBeNull();
		expect(partError({ type: 'ask', id: 'q', steps: [{ id: 'a', prompt: 'A?', kind: 'choice', options: [] }] })).toMatch(/options/);
		expect(partError({ type: 'ask', id: 'q', steps: [{ id: 'a', prompt: 'A?', kind: 'nope' }] })).toMatch(/unknown kind/);
		expect(partError({ type: 'ask', id: 'q', steps: [{ id: 'a', prompt: 'A', kind: 'text' }, { id: 'a', prompt: 'B', kind: 'text' }] })).toMatch(/duplicate/);
		expect(partError({ type: 'video' })).toMatch(/unknown type/);
	});

	it('validates step values', () => {
		const choice = { id: 'c', prompt: 'C', kind: 'choice' as const, multiple: true, min: 1, max: 2, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] };
		expect(validateStep({ ...choice, required: true }, [])).toBe('required');
		expect(validateStep(choice, ['a', 'b', 'c'])).toBe('invalid');
		expect(validateStep(choice, ['a', 'z'])).toBe('invalid');
		expect(validateStep(choice, ['a'])).toBeNull();
		expect(validateStep({ id: 't', prompt: 'T', kind: 'text', pattern: '[a-z]+' }, 'abc1')).toBe('invalid');
		expect(validateStep({ id: 'r', prompt: 'R', kind: 'rating' }, 6)).toBe('invalid');
		expect(validateStep({ id: 'd', prompt: 'D', kind: 'date', min: '2026-01-01' }, '2025-12-31')).toBe('invalid');
		expect(validateStep({ id: 'k', prompt: 'K', kind: 'confirm' }, false)).toBeNull();
		expect(isCorrect({ ...choice, correct: ['b', 'a'] }, ['a', 'b'])).toBe(true);
		expect(isCorrect({ ...choice, correct: 'a' }, 'b')).toBe(false);
	});

	it('formats answers', () => {
		const part: AskPart = {
			type: 'ask',
			id: 'p',
			steps: [
				{ id: 'size', prompt: 'Size?', kind: 'choice', options: [{ value: 's', label: 'Small' }] },
				{ id: 'ok', prompt: 'Gift?', kind: 'confirm' }
			]
		};
		expect(formatAnswer(part, { size: 's', ok: true })).toBe('Size? Small\nGift? Yes');
	});
});

describe('tables', () => {
	const rows = [['Paris', '2 100 000'], ['lyon', '520000'], ['Ajaccio', '72000']];
	it('sorts numbers numerically and text naturally', () => {
		expect(sortRows(rows, 1).map((r) => r[0])).toEqual(['Ajaccio', 'lyon', 'Paris']);
		expect(sortRows(rows, 0, 'desc').map((r) => r[0])).toEqual(['Paris', 'lyon', 'Ajaccio']);
		expect(sortRows([['item 10'], ['item 2']], 0).map((r) => r[0])).toEqual(['item 2', 'item 10']);
	});
	it('filters on every word, any cell', () => {
		expect(filterRows(rows, 'LY 52')).toEqual([rows[1]]);
		expect(filterRows(rows, '')).toBe(rows);
	});
	it('parses quoted CSV', () => {
		expect(parseCSV('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
	});
	it('enhances a rendered Markdown table', async () => {
		const div = document.createElement('div');
		div.innerHTML = renderMarkdown('| City | Pop |\n|---|---|\n| B | 2 |\n| A | 10 |\n| C | 1 |');
		const table = div.querySelector('table')!;
		enhanceTable(table, { filter: 'Filter', sortBy: 'Sort by' });
		(div.querySelector('[aria-label="Sort by Pop"]') as HTMLButtonElement).click();
		expect([...table.tBodies[0].rows].map((r) => r.cells[0].textContent)).toEqual(['C', 'B', 'A']);
		const input = div.querySelector('input[type=search]') as HTMLInputElement;
		input.value = 'b';
		input.dispatchEvent(new Event('input'));
		expect([...table.tBodies[0].rows].filter((r) => !r.hidden).length).toBe(1);
	});
});

describe('markdown extras', () => {
	it('renders callouts, footnotes, task lists and citations', () => {
		const html = renderMarkdown('> [!WARNING]\n> Careful\n\nSee[^a] and [1].\n\n- [x] done\n\n[^a]: The note.', { sources: [{ title: 'Doc', url: 'https://ex.com/a' }] });
		expect(html).toContain('cu-callout cu-warning');
		expect(html).toMatch(/cu-fn-ref.*href="#cu-fn-a"/);
		expect(html).toContain('class="cu-cite" href="https://ex.com/a"');
		expect(html).toContain('type="checkbox"');
	});
	it('keeps animated SVG but strips scripts and href animations', () => {
		const html = renderMarkdown('```svg\n<svg><circle r="4"><animate attributeName="r" values="4;8" dur="1s"/></circle><animate attributeName="href" to="javascript:alert(1)"/><script>alert(1)</script></svg>\n```');
		expect(html).toContain('<animate');
		expect(html).not.toMatch(/javascript:|<script/);
	});
});

describe('previewer registry', () => {
	it('picks exact MIME, then extension, then family, then *', () => {
		const A = (() => {}) as never;
		const B = { load: async () => ({ default: A }) };
		const offs = [registerPreviewer('image/*', A), registerPreviewer('.glb', B), registerPreviewer('image/png', B)];
		expect(findPreviewer({ name: 'x.png', mime: 'image/png' })).toBe(B);
		expect(findPreviewer({ name: 'x.jpg', mime: 'image/jpeg' })).toBe(A);
		expect(findPreviewer({ name: 'm.GLB', mime: 'application/octet-stream' })).toBe(B);
		expect(findPreviewer({ name: 'x.txt', mime: 'text/plain' })).toBeUndefined();
		offs.forEach((off) => off());
		expect(findPreviewer({ name: 'x.png', mime: 'image/png' })).toBeUndefined();
	});
	it('falls back to built-in kinds', () => {
		expect(builtinKind({ name: 'a.svg', mime: 'image/svg+xml' })).toBe('svg');
		expect(builtinKind({ name: 'data.csv', mime: '' })).toBe('csv');
		expect(builtinKind({ name: 'main.rs', mime: '' })).toBe('text');
		expect(builtinKind({ name: 'scene.glb', mime: 'model/gltf-binary' })).toBe('download');
	});
});

describe('thread helpers', () => {
	it('branches on retry and switches back with the old tail', () => {
		let m: ChatMessage[] = [
			{ id: 'u', role: 'user', content: 'q' },
			{ id: 'a1', role: 'assistant', content: 'first' },
			{ id: 'u2', role: 'user', content: 'more' }
		];
		m = branch(m, 1, { id: 'a2', role: 'assistant', content: 'second' });
		expect(m.map((x) => x.id)).toEqual(['u', 'a2']);
		expect(m[1].versions?.length).toBe(2);
		m = switchVersion(m, 1, 0);
		expect(m.map((x) => x.content)).toEqual(['q', 'first', 'more']);
		m = switchVersion(m, 1, 1);
		expect(m.map((x) => x.content)).toEqual(['q', 'second']);
	});
	it('exports and searches', () => {
		const m: ChatMessage[] = [{ id: '1', role: 'user', content: 'Crème brûlée' }, { id: '2', role: 'assistant', content: 'ok' }];
		expect(toMarkdown(m)).toContain('**user**\n\nCrème brûlée');
		expect([...searchMessages(m, 'creme')]).toEqual(['1']);
	});
});

describe('interactive parts', () => {
	const msg = (part: AskPart): ChatMessage[] => [{ id: 'a', role: 'assistant', content: 'Pick', parts: [part] }];

	it('a button choice answers in one click, shows the reply and locks', async () => {
		const onAction = vi.fn();
		render(Chat, { messages: msg({ type: 'ask', id: 'p', steps: [{ id: 's', prompt: 'Colour?', kind: 'choice', options: [{ value: 'r', label: 'Red', icon: '🔴' }, { value: 'b', label: 'Blue' }] }] }), onSend: () => {}, onAction });
		await fireEvent.click(screen.getByRole('button', { name: /Red/ }));
		expect(onAction).toHaveBeenCalledWith({ messageId: 'a', partId: 'p', value: 'r' });
		expect(screen.getByRole('note').textContent).toContain('Red');
		expect(screen.queryByRole('button', { name: /Blue/ })).toBeNull();
	});

	it('a wizard validates, goes back and submits a record', async () => {
		const onAction = vi.fn();
		render(Chat, {
			messages: msg({
				type: 'ask',
				id: 'w',
				steps: [
					{ id: 'name', prompt: 'Name?', kind: 'text', required: true },
					{ id: 'stars', prompt: 'Rate', kind: 'rating', max: 3 }
				]
			}),
			onSend: () => {},
			onAction
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('alert').textContent).toBe('This field is required.');
		await fireEvent.input(screen.getByRole('textbox', { name: 'Name?' }), { target: { value: 'Ada' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByText('Step 2/3'.replace('3', '2'))).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		expect((screen.getByRole('textbox', { name: 'Name?' }) as HTMLInputElement).value).toBe('Ada');
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await fireEvent.click(screen.getByRole('radio', { name: '2/3' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
		expect(onAction).toHaveBeenCalledWith({ messageId: 'a', partId: 'w', value: { name: 'Ada', stars: 2 } });
	});

	it('an answered part (from storage) renders locked', () => {
		render(Chat, { messages: msg({ type: 'ask', id: 'p', answer: true, steps: [{ id: 'c', prompt: 'Sure?', kind: 'confirm' }] }), onSend: () => {} });
		expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
		expect(screen.getByRole('note').textContent).toBe('Yes');
	});
});

describe('chat extras', () => {
	it('starters, follow-ups, feedback, tool cards, reasoning', async () => {
		const onSend = vi.fn();
		const onFeedback = vi.fn();
		const { rerender, container } = render(Chat, { messages: [], suggestions: ['Plan a trip'], onSend });
		await fireEvent.click(screen.getByRole('button', { name: 'Plan a trip' }));
		expect(onSend).toHaveBeenCalledWith('Plan a trip', []);
		await rerender({
			messages: [
				{ id: 'u', role: 'user', content: 'hi' },
				{ id: 'a', role: 'assistant', content: 'yo', reasoning: 'hmm', reasoningTime: 3, followUps: ['Why?'], parts: [{ type: 'tool', id: 't', name: 'search', status: 'done', args: { q: 'x' } }] }
			],
			onFeedback
		});
		expect(container.querySelector('.cu-reasoning summary')?.textContent).toBe('Thought for 3s');
		expect(container.querySelector('.cu-tool')?.textContent).toContain('search');
		await fireEvent.click(screen.getByRole('button', { name: 'Good answer' }));
		expect(onFeedback).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'up');
		await fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
		expect(onSend).toHaveBeenLastCalledWith('Why?', []);
	});

	it('Escape stops streaming', async () => {
		const onStop = vi.fn();
		render(Chat, { messages: [{ id: 'a', role: 'assistant', content: '' }], streaming: true, onSend: () => {}, onStop });
		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(onStop).toHaveBeenCalled();
	});
});
