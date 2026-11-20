<script lang="ts">
	// Demo: a fake model streams canned answers locally. Swap respond() for readSSE(await fetch(...)).
	import {
		Chat,
		branch,
		formatAnswer,
		katexBlock,
		lottieBlock,
		mermaidBlock,
		registerBlock,
		switchVersion,
		type AskPart,
		type ChatMessage,
		type MessagePart
	} from '../lib/index.js';

	// Heavy renderers load on first use only.
	registerBlock('mermaid', mermaidBlock(() => import('mermaid')));
	registerBlock('math', katexBlock(() => import('katex').then(async (m) => (await import('katex/dist/katex.min.css'), m))));
	registerBlock('lottie', lottieBlock(() => import('lottie-web')));

	const uid = () => Math.random().toString(36).slice(2);
	const blob = (s: string, type: string) => new Blob([s], { type });

	const showcase = `# Rich answers

Answers use a calm type scale, tables you can **sort and filter**, and lazy renderers.[^lazy] Sources are cited inline [1].

> [!TIP]
> Click a column header to sort, type in the box to filter.

| Model | Context | Price / 1M |
|---|---|---|
| Small | 32 000 | 0.20 |
| Medium | 128 000 | 1.50 |
| Large | 1 000 000 | 12 |

Euler, inline: $e^{i\\pi} + 1 = 0$, and displayed:

$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

\`\`\`mermaid
flowchart LR
  A[Prompt] --> B{Model}
  B -->|text| C[Markdown]
  B -->|parts| D[Files and forms]
\`\`\`

\`\`\`svg
<svg viewBox="0 0 120 40" width="240"><circle cx="20" cy="20" r="8" fill="currentColor"><animate attributeName="cx" values="20;100;20" dur="3s" repeatCount="indefinite"/></circle></svg>
\`\`\`

\`\`\`lottie
{"v":"5.7.4","fr":30,"ip":0,"op":60,"w":120,"h":120,"nm":"Pulse","layers":[{"ty":4,"nm":"dot","ip":0,"op":60,"st":0,"ks":{"o":{"a":0,"k":100},"r":{"a":0,"k":0},"p":{"a":0,"k":[60,60]},"a":{"a":0,"k":[0,0]},"s":{"a":1,"k":[{"t":0,"s":[60,60],"i":{"x":[0.5],"y":[1]},"o":{"x":[0.5],"y":[0]}},{"t":30,"s":[100,100],"i":{"x":[0.5],"y":[1]},"o":{"x":[0.5],"y":[0]}},{"t":60,"s":[60,60]}]}},"shapes":[{"ty":"el","p":{"a":0,"k":[0,0]},"s":{"a":0,"k":[60,60]}},{"ty":"fl","c":{"a":0,"k":[0.4,0.4,0.4,1]},"o":{"a":0,"k":100}}]}]}
\`\`\`

<details><summary>Collapsible section</summary>

Hidden until opened.

</details>

- [x] Task lists
- [ ] Footnotes

Long lists get a filter box:

- Apple
- Pear
- Cherry
- Banana
- Kiwi
- Mango
- Fig

[^lazy]: Mermaid, KaTeX and Lottie are loaded only when an answer needs them.`;

	const files: MessagePart[] = [
		{ type: 'file', id: 'csv', name: 'prices.csv', mime: 'text/csv', blob: blob('product,price,stock\nLamp,"1,299",12\nChair,89,140\nDesk,450,8\nRug,120,33\n', 'text/csv') },
		{ type: 'file', id: 'json', name: 'users.json', mime: 'application/json', blob: blob(JSON.stringify([{ name: 'Ada', role: 'admin', age: 36 }, { name: 'Linus', role: 'dev', age: 28 }]), 'application/json') },
		{
			type: 'file',
			id: 'code',
			name: 'add.ts',
			mime: 'text/typescript',
			versions: [
				{ label: 'v1', blob: blob('export const add = (a, b) => a + b;\n', 'text/plain') },
				{ label: 'v2 (typed)', blob: blob('export const add = (a: number, b: number): number => a + b;\n', 'text/plain') }
			],
			blob: blob('export const add = (a: number, b: number): number => a + b;\n', 'text/plain')
		},
		{ type: 'file', id: 'svg', name: 'logo.svg', mime: 'image/svg+xml', blob: blob('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#333"/><circle cx="50" cy="50" r="25" fill="#ddd"/></svg>', 'image/svg+xml') },
		{ type: 'file', id: 'html', name: 'page.html', mime: 'text/html', blob: blob('<h1 style="font-family:sans-serif">Sandboxed HTML</h1><p>Scripts do not run here.</p><script>document.body.append("script ran!")<\/script>', 'text/html') },
		{ type: 'file', id: 'md', name: 'notes.md', mime: 'text/markdown', blob: blob('# Notes\n\n- one\n- **two**\n', 'text/markdown') },
		{ type: 'file', id: 'glb', name: 'chair.glb', mime: 'model/gltf-binary', blob: blob('glTF', 'model/gltf-binary'), size: 4 }
	];

	const quiz: AskPart = {
		type: 'ask',
		id: 'quiz',
		title: 'Quick quiz',
		steps: [
			{ id: 'q1', prompt: 'Which planet is the largest?', kind: 'choice', display: 'radio', required: true, correct: 'j', options: [{ value: 'e', label: 'Earth' }, { value: 'j', label: 'Jupiter' }, { value: 's', label: 'Saturn' }] },
			{ id: 'q2', prompt: 'Pick the prime numbers', kind: 'choice', multiple: true, required: true, correct: ['2', '7'], options: [{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '7', label: '7' }] }
		]
	};
	const mood: AskPart = {
		type: 'ask',
		id: 'mood',
		steps: [{ id: 'm', prompt: 'How do you feel about this demo?', kind: 'choice', options: [{ value: 'love', label: 'Love it', icon: '😍' }, { value: 'ok', label: 'It is fine', icon: '🙂' }, { value: 'meh', label: 'Meh', icon: '😐' }] }]
	};
	const form: AskPart = {
		type: 'ask',
		id: 'form',
		title: 'Book a call',
		submitLabel: 'Book',
		steps: [
			{ id: 'name', prompt: 'Your name', kind: 'text', required: true, maxLength: 60 },
			{ id: 'topic', prompt: 'Topic', kind: 'choice', display: 'select', options: [{ value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }] },
			{ id: 'details', prompt: 'Details', kind: 'text', multiline: true, help: 'Optional' },
			{ id: 'team', prompt: 'Team size', kind: 'slider', min: 1, max: 50 },
			{ id: 'budget', prompt: 'Budget (EUR)', kind: 'number', min: 0, step: 100 },
			{ id: 'date', prompt: 'Date', kind: 'date', required: true },
			{ id: 'rating', prompt: 'How urgent?', kind: 'rating', max: 5 },
			{ id: 'brief', prompt: 'Attach a brief', kind: 'file', accept: 'image/*,.pdf' },
			{ id: 'ok', prompt: 'Send the invite?', kind: 'confirm', confirmLabel: 'Yes, send', cancelLabel: 'Not now' }
		]
	};

	let messages = $state<ChatMessage[]>([
		{ id: 's', role: 'system', content: 'Demo: answers are canned and streamed locally.' },
		{ id: 'u0', role: 'user', content: 'Show me everything.' },
		{
			id: 'a0',
			role: 'assistant',
			content: showcase,
			reasoning: 'The user wants a tour. I will show formatting, renderers, files and forms.',
			reasoningTime: 4,
			sources: [{ title: 'CommonMark spec', url: 'https://spec.commonmark.org/', snippet: 'A strongly defined, highly compatible specification of Markdown.' }],
			parts: [
				{ type: 'tool', id: 't1', name: 'search_docs', status: 'done', args: { query: 'markdown spec' }, result: { hits: 1 } },
				{ type: 'text', text: 'Generated files (click **Open** for the side panel):' },
				...files,
				quiz,
				mood,
				form
			]
		}
	]);
	let streaming = $state(false);
	let ctrl: AbortController | null = null;

	const answer = (q: string) =>
		`You said **${q.replace(/[*_\`]/g, '') || 'nothing'}**. Here is some code:\n\n\`\`\`ts\nexport function add(a: number, b: number) {\n  return a + b; // typed\n}\n\`\`\`\n\n> Shift+Enter for a new line, Esc to stop, / to focus, ↑ to edit your last message.`;

	async function respond(q: string, at = messages.length) {
		if (at === messages.length) messages.push({ id: uid(), role: 'assistant', content: '' });
		const m = messages[at];
		streaming = true;
		ctrl = new AbortController();
		m.parts = [{ type: 'tool', id: 'tool', name: 'think', status: 'running' }];
		await new Promise((r) => setTimeout(r, 400));
		m.parts = [{ type: 'tool', id: 'tool', name: 'think', status: 'done', result: 'ok' }];
		for (const word of answer(q).split(/(?<= )/)) {
			if (ctrl.signal.aborted) break;
			await new Promise((r) => setTimeout(r, 20));
			m.content += word;
		}
		m.followUps = ['Show a table', 'Explain the code'];
		streaming = false;
	}

	const lastUserText = (before: number) => messages.slice(0, before).findLast((m) => m.role === 'user')?.content ?? '';
</script>

<svelte:head><title>@sergeantweb/chat-ui demo</title></svelte:head>

<main style="height: 100dvh; margin: 0">
	<Chat
		{messages}
		{streaming}
		attachments
		toolbar
		suggestions={['Plan a weekend in Lyon', 'Explain closures in JS']}
		onSend={(text, files) => {
			messages.push({ id: uid(), role: 'user', content: text, attachments: files.map((f) => ({ name: f.name, size: f.size, type: f.type, url: URL.createObjectURL(f) })) });
			respond(text);
		}}
		onStop={() => ctrl?.abort()}
		onRetry={(m) => {
			const i = messages.findIndex((x) => x.id === m.id);
			messages = branch(messages, i, { id: uid(), role: 'assistant', content: '' });
			respond(lastUserText(i), i);
		}}
		onEdit={(m, text) => {
			const i = messages.findIndex((x) => x.id === m.id);
			messages = branch(messages, i, { ...m, id: uid(), content: text });
			respond(text);
		}}
		onVersion={(m, k) => (messages = switchVersion(messages, messages.findIndex((x) => x.id === m.id), k))}
		onFeedback={(m, v) => (messages.find((x) => x.id === m.id)!.feedback = v)}
		onAction={({ messageId, partId, value }) => {
			const part = messages.find((x) => x.id === messageId)?.parts?.find((p) => p.type === 'ask' && p.id === partId) as AskPart;
			part.answer = value;
			console.info('answer', formatAnswer(part, value));
		}}
	/>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
	}
</style>
