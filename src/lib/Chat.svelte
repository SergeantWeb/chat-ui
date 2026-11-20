<script lang="ts">
	import { tick } from 'svelte';
	import { loadHighlighter, renderMarkdown } from './markdown.js';
	import { defaultLabels, type ChatLabels, type ChatMessage } from './types.js';

	type Props = {
		messages: ChatMessage[];
		/** True while the assistant answers: shows Stop, disables Send, retry and edit. */
		streaming?: boolean;
		onSend: (text: string, files: File[]) => void;
		onStop?: () => void;
		/** Retry an assistant message (the last one, or one with an error). Omit to hide the button. */
		onRetry?: (message: ChatMessage) => void;
		/** Edit a user message and resubmit from there. Omit to hide the button. */
		onEdit?: (message: ChatMessage, text: string) => void;
		/** Show the attach button; `accept` is passed to the file input. */
		attachments?: boolean;
		accept?: string;
		labels?: Partial<ChatLabels>;
		class?: string;
	};
	let { messages, streaming = false, onSend, onStop, onRetry, onEdit, attachments = false, accept, labels = {}, class: cls = '' }: Props = $props();
	const t = $derived({ ...defaultLabels, ...labels });

	let text = $state('');
	let files = $state<File[]>([]);
	let log = $state<HTMLElement>();
	let input = $state<HTMLTextAreaElement>();
	let fileInput = $state<HTMLInputElement>();
	let atBottom = $state(true);
	let copied = $state<string | null>(null);
	let editing = $state<string | null>(null);
	let draft = $state('');
	let hl = $state(0); // bumps when highlight.js arrives, so code blocks re-render coloured

	const html = (m: ChatMessage) => {
		void hl;
		return renderMarkdown(m.content);
	};
	const lastAssistant = $derived(messages.findLast((m) => m.role === 'assistant')?.id);

	$effect(() => {
		if (messages.some((m) => m.content.includes('```'))) loadHighlighter().then(() => hl++);
	});

	// Follow the stream while the reader is at the bottom; leave them alone once they scroll up.
	$effect(() => {
		void messages.length, messages.at(-1)?.content;
		if (atBottom) tick().then(() => log && (log.scrollTop = log.scrollHeight));
	});

	// Auto-grow the composer up to a cap (CSS field-sizing does it natively where supported).
	$effect(() => {
		void text;
		if (!input) return;
		input.style.height = 'auto';
		input.style.height = Math.min(input.scrollHeight, 240) + 'px';
	});

	const onScroll = () => log && (atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48);
	const toBottom = () => log?.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });

	function send() {
		const v = text.trim();
		if (streaming || (!v && !files.length)) return;
		onSend(v, files);
		text = '';
		files = [];
		atBottom = true;
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	}

	async function copy(id: string, value: string) {
		await navigator.clipboard?.writeText(value);
		copied = id;
		setTimeout(() => copied === id && (copied = null), 1500);
	}

	// Code block copy buttons live inside {@html}: one delegated listener.
	function onLogClick(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
		const code = btn?.closest('.cu-code')?.querySelector('code')?.textContent;
		if (!btn || code == null) return;
		navigator.clipboard?.writeText(code);
		btn.textContent = t.copied;
		setTimeout(() => (btn.textContent = t.copy), 1500);
	}

	function startEdit(m: ChatMessage) {
		editing = m.id;
		draft = m.content;
	}
	function saveEdit(m: ChatMessage) {
		const v = draft.trim();
		editing = null;
		if (v && v !== m.content) onEdit?.(m, v);
	}

	function pick(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		files = [...files, ...(el.files ?? [])];
		el.value = '';
	}
</script>

<div class="cu {cls}">
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<div class="cu-log" role="log" aria-live="polite" aria-busy={streaming} aria-label={t.conversation} bind:this={log} onscroll={onScroll} onclick={onLogClick}>
		{#each messages as m (m.id)}
			<article class="cu-msg cu-{m.role}" aria-label={m.role}>
				{#if editing === m.id}
					<form class="cu-edit" onsubmit={(e) => (e.preventDefault(), saveEdit(m))}>
						<!-- svelte-ignore a11y_autofocus -->
						<textarea class="cu-input" bind:value={draft} aria-label={t.edit} autofocus onkeydown={(e) => e.key === 'Escape' && (editing = null)}></textarea>
						<div class="cu-row">
							<button type="button" class="cu-btn" onclick={() => (editing = null)}>{t.cancel}</button>
							<button type="submit" class="cu-btn cu-primary">{t.save}</button>
						</div>
					</form>
				{:else}
					<div class="cu-bubble">
						{#if m.role === 'assistant'}
							{#if m.content}
								<div class="cu-md">{@html html(m)}</div>
							{:else if streaming && m.id === lastAssistant}
								<span class="cu-thinking">{t.thinking}</span>
							{/if}
						{:else}
							<p class="cu-text">{m.content}</p>
						{/if}
						{#if m.attachments?.length}
							<ul class="cu-files">
								{#each m.attachments as a (a.name)}
									<li>{#if a.url}<a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a>{:else}{a.name}{/if}</li>
								{/each}
							</ul>
						{/if}
					</div>
					{#if m.error}<p class="cu-error" role="alert">{m.error}</p>{/if}
					{#if m.role !== 'system' && !(streaming && m.id === lastAssistant)}
						<div class="cu-actions">
							<button type="button" class="cu-btn" onclick={() => copy(m.id, m.content)}>{copied === m.id ? t.copied : t.copy}</button>
							{#if onRetry && m.role === 'assistant' && !streaming && (m.id === lastAssistant || m.error)}
								<button type="button" class="cu-btn" onclick={() => onRetry(m)}>{t.retry}</button>
							{/if}
							{#if onEdit && m.role === 'user' && !streaming}
								<button type="button" class="cu-btn" onclick={() => startEdit(m)}>{t.edit}</button>
							{/if}
						</div>
					{/if}
				{/if}
			</article>
		{/each}
	</div>

	{#if !atBottom}
		<button type="button" class="cu-btn cu-down" aria-label={t.scrollDown} onclick={toBottom}>↓</button>
	{/if}

	<form class="cu-composer" onsubmit={(e) => (e.preventDefault(), send())}>
		{#if files.length}
			<ul class="cu-files cu-pending">
				{#each files as f, i (f.name + i)}
					<li>{f.name} <button type="button" class="cu-btn" aria-label="{t.remove} {f.name}" onclick={() => (files = files.filter((_, j) => j !== i))}>×</button></li>
				{/each}
			</ul>
		{/if}
		<div class="cu-row">
			{#if attachments}
				<input type="file" multiple {accept} hidden bind:this={fileInput} onchange={pick} />
				<button type="button" class="cu-btn" aria-label={t.attach} title={t.attach} onclick={() => fileInput?.click()}>+</button>
			{/if}
			<textarea class="cu-input" rows="1" bind:this={input} bind:value={text} onkeydown={keydown} placeholder={t.placeholder} aria-label={t.placeholder}></textarea>
			{#if streaming}
				<button type="button" class="cu-btn cu-primary" onclick={() => onStop?.()}>{t.stop}</button>
			{:else}
				<button type="submit" class="cu-btn cu-primary" disabled={!text.trim() && !files.length}>{t.send}</button>
			{/if}
		</div>
	</form>
</div>

<style>
	/* Theme: set any --chat-* (bg, fg, card, soft, muted, line, primary, on-primary, bad, code-bg, code-fg, radius, font, mono, max) on an ancestor. Defaults follow the sergeantweb neutral grey theme. */
	.cu {
		--cu-bg: var(--chat-bg, oklch(0.96 0 0));
		--cu-fg: var(--chat-fg, oklch(0.22 0 0));
		--cu-card: var(--chat-card, oklch(0.99 0 0));
		--cu-soft: var(--chat-soft, oklch(0.92 0 0));
		--cu-muted: var(--chat-muted, oklch(0.45 0 0));
		--cu-line: var(--chat-line, oklch(0.22 0 0 / 14%));
		--cu-primary: var(--chat-primary, oklch(0.22 0 0));
		--cu-on-primary: var(--chat-on-primary, oklch(0.99 0 0));
		--cu-bad: var(--chat-bad, oklch(0.55 0.22 27));
		--cu-code-bg: var(--chat-code-bg, oklch(0.22 0 0));
		--cu-code-fg: var(--chat-code-fg, oklch(0.93 0 0));
		--cu-radius: var(--chat-radius, 1rem);
		--cu-font: var(--chat-font, inherit);
		--cu-mono: var(--chat-mono, ui-monospace, 'JetBrains Mono Variable', monospace);
		--cu-max: var(--chat-max, 48rem);
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--cu-bg);
		color: var(--cu-fg);
		font-family: var(--cu-font);
		font-size: 15px;
		line-height: 1.6;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']):not(.light)) .cu {
			--cu-bg: var(--chat-bg, oklch(0.2 0 0));
			--cu-fg: var(--chat-fg, oklch(0.95 0 0));
			--cu-card: var(--chat-card, oklch(0.235 0 0));
			--cu-soft: var(--chat-soft, oklch(0.29 0 0));
			--cu-muted: var(--chat-muted, oklch(0.74 0 0));
			--cu-line: var(--chat-line, oklch(0.95 0 0 / 12%));
			--cu-primary: var(--chat-primary, oklch(0.95 0 0));
			--cu-on-primary: var(--chat-on-primary, oklch(0.2 0 0));
			--cu-code-bg: var(--chat-code-bg, oklch(0.16 0 0));
		}
	}
	:global(:root.dark) .cu,
	:global(:root[data-theme='dark']) .cu {
		--cu-bg: var(--chat-bg, oklch(0.2 0 0));
		--cu-fg: var(--chat-fg, oklch(0.95 0 0));
		--cu-card: var(--chat-card, oklch(0.235 0 0));
		--cu-soft: var(--chat-soft, oklch(0.29 0 0));
		--cu-muted: var(--chat-muted, oklch(0.74 0 0));
		--cu-line: var(--chat-line, oklch(0.95 0 0 / 12%));
		--cu-primary: var(--chat-primary, oklch(0.95 0 0));
		--cu-on-primary: var(--chat-on-primary, oklch(0.2 0 0));
		--cu-code-bg: var(--chat-code-bg, oklch(0.16 0 0));
	}
	.cu-log {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.cu-msg {
		width: 100%;
		max-width: var(--cu-max);
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.cu-user {
		align-items: flex-end;
	}
	.cu-user .cu-bubble {
		background: var(--cu-soft);
		border-radius: var(--cu-radius);
		padding: 8px 14px;
		max-width: 85%;
	}
	.cu-system .cu-bubble {
		color: var(--cu-muted);
		font-size: 13px;
		text-align: center;
		width: 100%;
	}
	.cu-text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.cu-thinking {
		color: var(--cu-muted);
		animation: cu-pulse 1.4s ease-in-out infinite;
	}
	@keyframes cu-pulse {
		50% {
			opacity: 0.4;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cu-thinking {
			animation: none;
		}
	}
	.cu-error {
		margin: 0;
		color: var(--cu-bad);
		font-size: 13px;
	}
	.cu-actions {
		display: flex;
		gap: 4px;
		opacity: 0.75;
	}
	.cu-msg:hover .cu-actions,
	.cu-actions:focus-within {
		opacity: 1;
	}
	.cu-btn,
	.cu :global(.cu-btn) {
		font: inherit;
		font-size: 12.5px;
		color: var(--cu-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.cu-btn:hover,
	.cu :global(.cu-btn:hover) {
		background: var(--cu-soft);
		color: var(--cu-fg);
	}
	.cu-btn:focus-visible,
	.cu-edit .cu-input:focus-visible,
	.cu :global(.cu-btn:focus-visible) {
		outline: 2px solid var(--cu-fg);
		outline-offset: 2px;
	}
	.cu-primary {
		background: var(--cu-primary);
		color: var(--cu-on-primary);
		font-size: 14px;
		padding: 6px 16px;
	}
	.cu-primary:hover {
		background: var(--cu-primary);
		color: var(--cu-on-primary);
		opacity: 0.9;
	}
	.cu-primary:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.cu-down {
		position: absolute;
		right: 50%;
		transform: translateX(50%);
		bottom: 88px;
		background: var(--cu-card);
		border-color: var(--cu-line);
		font-size: 16px;
		width: 36px;
		height: 36px;
		padding: 0;
	}
	.cu-composer {
		width: 100%;
		max-width: var(--cu-max);
		margin: 0 auto;
		padding: 0 16px 16px;
		box-sizing: border-box;
	}
	.cu-composer > .cu-row {
		align-items: flex-end;
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: calc(var(--cu-radius) * 1.5);
		padding: 8px;
	}
	.cu-composer > .cu-row:focus-within {
		border-color: var(--cu-muted);
	}
	.cu-composer .cu-input {
		outline: none;
	}
	.cu-row {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	.cu-input {
		flex: 1;
		resize: none;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		padding: 6px 8px;
		field-sizing: content;
		max-height: 240px;
		min-width: 0;
	}
	.cu-edit {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cu-edit .cu-input {
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: var(--cu-radius);
		min-height: 4em;
	}
	.cu-files {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 13px;
	}
	.cu-files li {
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: 999px;
		padding: 2px 4px 2px 10px;
	}
	.cu-pending {
		margin: 0 0 8px;
	}
	/* Markdown */
	.cu-md {
		overflow-wrap: anywhere;
	}
	.cu-md :global(:first-child) {
		margin-top: 0;
	}
	.cu-md :global(:last-child) {
		margin-bottom: 0;
	}
	.cu-md :global(a) {
		color: inherit;
		text-underline-offset: 3px;
	}
	.cu-md :global(:not(pre) > code) {
		font-family: var(--cu-mono);
		font-size: 0.9em;
		background: var(--cu-soft);
		border-radius: 6px;
		padding: 1px 5px;
	}
	.cu-md :global(table) {
		border-collapse: collapse;
		display: block;
		overflow-x: auto;
	}
	.cu-md :global(th),
	.cu-md :global(td) {
		border: 1px solid var(--cu-line);
		padding: 4px 10px;
	}
	.cu-md :global(blockquote) {
		margin-left: 0;
		padding-left: 12px;
		border-left: 3px solid var(--cu-line);
		color: var(--cu-muted);
	}
	.cu-md :global(.cu-code) {
		background: var(--cu-code-bg);
		color: var(--cu-code-fg);
		border-radius: calc(var(--cu-radius) * 0.75);
		margin: 12px 0;
		overflow: hidden;
	}
	.cu-md :global(.cu-code-bar) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 8px 4px 14px;
		font-size: 12px;
		opacity: 0.8;
	}
	.cu-md :global(.cu-code .cu-btn) {
		color: inherit;
	}
	.cu-md :global(.cu-code .cu-btn:hover) {
		background: oklch(1 0 0 / 12%);
	}
	.cu-md :global(pre) {
		margin: 0;
		padding: 0 14px 14px;
		overflow-x: auto;
		font-family: var(--cu-mono);
		font-size: 13px;
		line-height: 1.5;
	}
	/* highlight.js tokens, tuned for the dark code background */
	.cu-md :global(.hljs-keyword),
	.cu-md :global(.hljs-built_in),
	.cu-md :global(.hljs-selector-tag) {
		color: oklch(0.78 0.12 300);
	}
	.cu-md :global(.hljs-string),
	.cu-md :global(.hljs-attr),
	.cu-md :global(.hljs-template-variable) {
		color: oklch(0.82 0.12 145);
	}
	.cu-md :global(.hljs-number),
	.cu-md :global(.hljs-literal) {
		color: oklch(0.82 0.12 65);
	}
	.cu-md :global(.hljs-comment) {
		color: oklch(0.65 0 0);
		font-style: italic;
	}
	.cu-md :global(.hljs-title),
	.cu-md :global(.hljs-function),
	.cu-md :global(.hljs-type) {
		color: oklch(0.8 0.1 230);
	}
</style>
