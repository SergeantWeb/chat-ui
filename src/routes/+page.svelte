<script lang="ts">
	// Demo: a fake model that streams a canned Markdown answer word by word. Swap respond() for readSSE(await fetch(...)).
	import { Chat, type ChatMessage } from '../lib/index.js';

	let messages = $state<ChatMessage[]>([{ id: 's', role: 'system', content: 'Demo: answers are canned and streamed locally.' }]);
	let streaming = $state(false);
	let ctrl: AbortController | null = null;
	const uid = () => Math.random().toString(36).slice(2);

	const answer = (q: string) =>
		`You said **${q.replace(/[*_`]/g, '') || 'nothing'}**. Here is some code:\n\n\`\`\`ts\nexport function add(a: number, b: number) {\n  return a + b; // typed\n}\n\`\`\`\n\n| Feature | Status |\n|---|---|\n| Streaming | yes |\n| Copy / retry / edit | yes |\n\n> Shift+Enter for a new line.`;

	async function respond(q: string) {
		const msg: ChatMessage = { id: uid(), role: 'assistant', content: '' };
		messages.push(msg);
		const m = messages.at(-1)!;
		streaming = true;
		ctrl = new AbortController();
		for (const word of answer(q).split(/(?<= )/)) {
			if (ctrl.signal.aborted) break;
			await new Promise((r) => setTimeout(r, 25));
			m.content += word;
		}
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
		onSend={(text, files) => {
			messages.push({ id: uid(), role: 'user', content: text, attachments: files.map((f) => ({ name: f.name, size: f.size })) });
			respond(text);
		}}
		onStop={() => ctrl?.abort()}
		onRetry={(m) => {
			const i = messages.findIndex((x) => x.id === m.id);
			const q = lastUserText(i);
			messages.splice(i);
			respond(q);
		}}
		onEdit={(m, text) => {
			const i = messages.findIndex((x) => x.id === m.id);
			messages.splice(i, messages.length - i, { ...m, content: text });
			respond(text);
		}}
	/>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
	}
</style>
