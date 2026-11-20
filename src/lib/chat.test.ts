import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Chat from './Chat.svelte';
import { renderMarkdown } from './markdown.js';
import { readSSE } from './stream.js';
import type { ChatMessage } from './types.js';

Element.prototype.scrollTo = () => {};
afterEach(cleanup);

const msgs: ChatMessage[] = [
	{ id: 'u1', role: 'user', content: 'hello' },
	{ id: 'a1', role: 'assistant', content: 'Hi **there**\n\n```js\nconst x = 1;\n```' }
];

describe('Chat', () => {
	it('renders markdown and code blocks', () => {
		const { container } = render(Chat, { messages: msgs, onSend: () => {} });
		expect(container.querySelector('.cu-md strong')?.textContent).toBe('there');
		expect(container.querySelector('.cu-code code')?.textContent).toContain('const x = 1;');
		expect(screen.getByRole('log')).toBeTruthy();
	});

	it('sends on Enter, not on Shift+Enter, then clears', async () => {
		const onSend = vi.fn();
		render(Chat, { messages: [], onSend });
		const box = screen.getByRole('textbox') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'line' } });
		await fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
		expect(onSend).not.toHaveBeenCalled();
		await fireEvent.keyDown(box, { key: 'Enter' });
		expect(onSend).toHaveBeenCalledWith('line', []);
		expect(box.value).toBe('');
	});

	it('shows Stop while streaming and hides Send', async () => {
		const onStop = vi.fn();
		render(Chat, { messages: msgs, streaming: true, onSend: () => {}, onStop });
		expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect(onStop).toHaveBeenCalled();
	});

	it('retries the last assistant message and edits a user message', async () => {
		const onRetry = vi.fn();
		const onEdit = vi.fn();
		render(Chat, { messages: msgs, onSend: () => {}, onRetry, onEdit });
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onRetry).toHaveBeenCalledWith(msgs[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		const edit = screen.getByRole('textbox', { name: 'Edit' });
		await fireEvent.input(edit, { target: { value: 'hello again' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save & submit' }));
		expect(onEdit).toHaveBeenCalledWith(msgs[0], 'hello again');
	});
});

describe('renderMarkdown', () => {
	it('strips scripts and event handlers', () => {
		const html = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>[a](javascript:alert(3))');
		expect(html).not.toMatch(/onerror|<script|javascript:/);
	});
});

describe('readSSE', () => {
	it('parses events split across chunks, multi-line data and comments', async () => {
		const chunks = [': ping\n\ndata: hel', 'lo\n\nevent: done\ndata: a\ndata: b\n\n'];
		const body = new ReadableStream({
			start(c) {
				for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
				c.close();
			}
		});
		const out = [];
		for await (const e of readSSE(new Response(body))) out.push(e);
		expect(out).toEqual([
			{ event: 'message', data: 'hello' },
			{ event: 'done', data: 'a\nb' }
		]);
	});
});
