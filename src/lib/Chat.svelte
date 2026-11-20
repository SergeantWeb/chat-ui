<script lang="ts">
	import { onMount, tick } from 'svelte';
	import AskForm from './AskForm.svelte';
	import FileView from './FileView.svelte';
	import Markdown from './Markdown.svelte';
	import PreviewPanel from './PreviewPanel.svelte';
	import { loadHighlighter, renderMarkdown } from './markdown.js';
	import { fileToPart, fileUrl } from './parts.js';
	import { builtinKind, extOf } from './previewers.js';
	import { download, searchMessages, toJSON, toMarkdown } from './thread.js';
	import { defaultLabels, type Attachment, type ChatAction, type ChatLabels, type ChatMessage, type FilePart } from './types.js';

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
		/** The user answered an "ask" part. The answer is shown as their reply and the part is locked. */
		onAction?: (action: ChatAction) => void;
		/** Thumbs up/down on assistant messages (null = cleared). Omit to hide the buttons. */
		onFeedback?: (message: ChatMessage, value: 'up' | 'down' | null) => void;
		/** Switch between versions of a message (see branch() / switchVersion()). Omit to hide the < n/m > switcher. */
		onVersion?: (message: ChatMessage, index: number) => void;
		/** Starter prompts shown on an empty conversation. */
		suggestions?: string[];
		/** Shows the search and export bar. */
		toolbar?: boolean;
		/** Attach button, drag & drop, paste and (on touch devices) camera; `accept` is passed to the file input. */
		attachments?: boolean;
		accept?: string;
		/** sandbox attribute for HTML file previews. Default '' (no scripts). */
		htmlSandbox?: string;
		labels?: Partial<ChatLabels>;
		class?: string;
	};
	let {
		messages,
		streaming = false,
		onSend,
		onStop,
		onRetry,
		onEdit,
		onAction,
		onFeedback,
		onVersion,
		suggestions = [],
		toolbar = false,
		attachments = false,
		accept,
		htmlSandbox = '',
		labels = {},
		class: cls = ''
	}: Props = $props();
	const t = $derived({ ...defaultLabels, ...labels });

	let text = $state('');
	let files = $state<File[]>([]);
	let root = $state<HTMLElement>();
	let log = $state<HTMLElement>();
	let input = $state<HTMLTextAreaElement>();
	let fileInput = $state<HTMLInputElement>();
	let camInput = $state<HTMLInputElement>();
	let atBottom = $state(true);
	let copied = $state<string | null>(null);
	let editing = $state<string | null>(null);
	let draft = $state('');
	let hl = $state(0); // bumps when highlight.js arrives, so code blocks re-render coloured
	let answers = $state<Record<string, unknown>>({});
	let dragging = $state(false);
	let query = $state('');
	let open = $state<FilePart[]>([]);
	let tab = $state(0);
	let speaking = $state<string | null>(null);
	let listening = $state(false);
	let touch = $state(false);
	let mounted = $state(false); // blob URLs exist only in the browser
	let canListen = $state(false);
	let canSpeak = $state(false);
	let recognition: { stop(): void } | null = null;

	onMount(() => {
		mounted = true;
		touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
		canListen = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
		canSpeak = 'speechSynthesis' in window;
		return () => canSpeak && speechSynthesis.cancel();
	});

	const html = (m: ChatMessage) => {
		void hl;
		return renderMarkdown(m.content, { sources: m.sources });
	};
	const lastAssistant = $derived(messages.findLast((m) => m.role === 'assistant')?.id);
	const lastUser = $derived(messages.findLast((m) => m.role === 'user'));
	const empty = $derived(!messages.some((m) => m.role !== 'system'));
	const matches = $derived(toolbar && query.trim() ? searchMessages(messages, query) : null);

	$effect(() => {
		if (messages.some((m) => m.content.includes('```'))) loadHighlighter().then(() => hl++);
	});

	// Follow the stream while the reader is at the bottom; leave them alone once they scroll up.
	$effect(() => {
		void messages.length, messages.at(-1)?.content, messages.at(-1)?.parts?.length;
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

	function send(v = text.trim()) {
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
		} else if (e.key === 'ArrowUp' && !text && onEdit && lastUser && !streaming) {
			e.preventDefault();
			startEdit(lastUser);
		}
	}

	// Shortcuts: Esc stops, "/" focuses the composer, Ctrl/Cmd+Shift+C copies the last answer.
	function globalKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		const inField = target.closest('input, textarea, select, [contenteditable]');
		const ours = target === document.body || root?.contains(target);
		if (!ours) return;
		if (e.key === 'Escape' && streaming && !target.closest('.cu-panel')) {
			e.preventDefault();
			onStop?.();
		} else if (e.key === '/' && !inField && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			input?.focus();
		} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
			const m = messages.findLast((x) => x.role === 'assistant');
			if (m) (e.preventDefault(), copy(m.id, m.content));
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

	const addFiles = (list: Iterable<File> | null | undefined) => list && (files = [...files, ...list]);
	function pick(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		addFiles(el.files);
		el.value = '';
	}
	function paste(e: ClipboardEvent) {
		if (!attachments || !e.clipboardData?.files.length) return;
		e.preventDefault();
		addFiles(e.clipboardData.files);
	}
	function drop(e: DragEvent) {
		dragging = false;
		if (!attachments || !e.dataTransfer?.files.length) return;
		e.preventDefault();
		addFiles(e.dataTransfer.files);
		input?.focus();
	}

	function openFile(f: FilePart) {
		const i = open.findIndex((x) => x.id === f.id);
		if (i >= 0) tab = i;
		else (open = [...open, f]), (tab = open.length - 1);
	}
	const attachmentPart = (a: Attachment, i: number): FilePart => ({ type: 'file', id: `${a.name}-${i}-${a.url}`, name: a.name, mime: a.type ?? '', url: a.url, size: a.size });

	function answer(m: ChatMessage, partId: string, value: unknown) {
		answers[`${m.id}:${partId}`] = value;
		onAction?.({ messageId: m.id, partId, value });
	}

	const plain = (md: string) => new DOMParser().parseFromString(renderMarkdown(md), 'text/html').body.textContent ?? '';
	function speak(m: ChatMessage) {
		speechSynthesis.cancel();
		if (speaking === m.id) return void (speaking = null);
		const u = new SpeechSynthesisUtterance(plain(m.content));
		u.lang = document.documentElement.lang || navigator.language;
		u.onend = u.onerror = () => speaking === m.id && (speaking = null);
		speaking = m.id;
		speechSynthesis.speak(u);
	}

	function listen() {
		if (listening) return recognition?.stop();
		const w = window as unknown as Record<string, new () => any>;
		const rec = new (w.SpeechRecognition ?? w.webkitSpeechRecognition)();
		const base = text ? text.replace(/\s*$/, ' ') : '';
		rec.lang = document.documentElement.lang || navigator.language;
		rec.interimResults = true;
		rec.continuous = false;
		rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => (text = base + Array.from(e.results, (r) => r[0].transcript).join(''));
		rec.onend = () => ((listening = false), input?.focus());
		rec.start();
		recognition = rec;
		listening = true;
	}

	const fmt = (s: string, n: number | string) => s.replace('{n}', String(n));
</script>

<svelte:window onkeydown={globalKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="cu {cls}"
	bind:this={root}
	ondragover={(e) => attachments && e.dataTransfer?.types.includes('Files') && (e.preventDefault(), (dragging = true))}
	ondragleave={(e) => e.target === e.currentTarget && (dragging = false)}
	ondrop={drop}
>
	<div class="cu-main">
		{#if toolbar}
			<div class="cu-toolbar">
				<input type="search" class="cu-filter" placeholder="{t.search}…" aria-label={t.search} bind:value={query} />
				{#if matches}<span class="cu-muted" aria-live="polite">{fmt(t.matches, matches.size)}</span>{/if}
				<span class="cu-grow"></span>
				<button type="button" class="cu-btn" onclick={() => download('conversation.md', toMarkdown(messages), 'text/markdown')}>{t.exportMd}</button>
				<button type="button" class="cu-btn" onclick={() => download('conversation.json', toJSON(messages), 'application/json')}>{t.exportJson}</button>
			</div>
		{/if}

		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<div class="cu-log" role="log" aria-live="polite" aria-busy={streaming} aria-label={t.conversation} bind:this={log} onscroll={onScroll} onclick={onLogClick}>
			{#if empty && suggestions.length}
				<div class="cu-starters" role="group" aria-label={t.suggestions}>
					{#each suggestions as s (s)}
						<button type="button" class="cu-starter" onclick={() => send(s)}>{s}</button>
					{/each}
				</div>
			{/if}
			{#each messages as m, mi (m.id)}
				<article class="cu-msg cu-{m.role}" aria-label={m.role} hidden={matches ? !matches.has(m.id) : undefined}>
					{#if editing === m.id}
						<form class="cu-edit" onsubmit={(e) => (e.preventDefault(), saveEdit(m))}>
							<!-- svelte-ignore a11y_autofocus -->
							<textarea class="cu-input" bind:value={draft} aria-label={t.edit} autofocus onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), (editing = null))}></textarea>
							<div class="cu-row">
								<button type="button" class="cu-btn" onclick={() => (editing = null)}>{t.cancel}</button>
								<button type="submit" class="cu-btn cu-primary">{t.save}</button>
							</div>
						</form>
					{:else}
						{#if m.reasoning}
							{@const thinking = streaming && m.id === lastAssistant && !m.content}
							<details class="cu-reasoning" open={thinking}>
								<summary>{thinking ? t.thinking : m.reasoningTime != null ? fmt(t.thoughtFor, Math.round(m.reasoningTime)) : t.thinkingBlock}</summary>
								<p class="cu-text">{m.reasoning}</p>
							</details>
						{/if}
						<div class="cu-bubble">
							{#if m.role === 'assistant'}
								{#if m.content && !mounted}
									<p class="cu-text">{m.content}</p>
								{:else if m.content}
									<Markdown html={html(m)} labels={t} />
								{:else if streaming && m.id === lastAssistant && !m.reasoning && !m.parts?.length}
									<span class="cu-thinking">{t.thinking}</span>
								{/if}
							{:else}
								<p class="cu-text">{m.content}</p>
							{/if}
							{#if m.attachments?.length}
								<ul class="cu-files">
									{#each m.attachments as a, i (i)}
										<li>
											{#if a.url}
												<button type="button" class="cu-thumb" onclick={() => openFile(attachmentPart(a, i))} aria-label="{t.open} {a.name}">
													{#if a.type?.startsWith('image/')}<img src={a.url} alt="" />{:else}<span class="cu-fv-ext">{extOf(a.name).slice(1).toUpperCase() || 'FILE'}</span>{/if}
													<span>{a.name}</span>
												</button>
											{:else}<span class="cu-thumb"><span>{a.name}</span></span>{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						{#each m.parts ?? [] as p, pi (p.id ?? pi)}
							{#if p.type === 'text' && !mounted}
								<p class="cu-text">{p.text}</p>
							{:else if p.type === 'text'}
								<Markdown html={renderMarkdown(p.text, { sources: m.sources })} labels={t} />
							{:else if p.type === 'tool'}
								<details class="cu-tool cu-tool-{p.status}">
									<summary>
										<span class="cu-tool-name">{t.tool} <code>{p.name}</code></span>
										<span class="cu-badge" role="status">{p.status === 'running' ? t.running : p.status === 'done' ? t.done : t.failed}</span>
									</summary>
									{#if p.args !== undefined}<p class="cu-muted">{t.arguments}</p><pre>{typeof p.args === 'string' ? p.args : JSON.stringify(p.args, null, 2)}</pre>{/if}
									{#if p.result !== undefined}<p class="cu-muted">{t.result}</p><pre>{typeof p.result === 'string' ? p.result : JSON.stringify(p.result, null, 2)}</pre>{/if}
								</details>
							{:else if p.type === 'file' && mounted}
								{@const kind = builtinKind(p)}
								<figure class="cu-file">
									<figcaption>
										<span class="cu-file-name">{p.name}</span>
										<button type="button" class="cu-btn" onclick={() => openFile(p)}>{t.open}</button>
										<a class="cu-btn" href={fileUrl(p)} download={p.name}>{t.download}</a>
									</figcaption>
									{#if kind !== 'download' && kind !== 'pdf' && kind !== 'html'}
										<FileView file={p} url={fileUrl(p)} labels={t} {htmlSandbox} inline />
									{:else if kind !== 'download'}
										<button type="button" class="cu-file-open" onclick={() => openFile(p)}>{t.preview} · {extOf(p.name).slice(1).toUpperCase()}</button>
									{/if}
								</figure>
							{:else if p.type === 'ask'}
								{@const key = `${m.id}:${p.id}`}
								{@const done = p.answer !== undefined || key in answers}
								<AskForm part={p} labels={t} answered={done} answer={p.answer !== undefined ? p.answer : answers[key]} onanswer={(v) => answer(m, p.id, v)} />
							{/if}
						{/each}
						{#if m.sources?.length}
							<ol class="cu-sources" aria-label={t.sources}>
								{#each m.sources as s, i (i)}
									<li>
										<a href={s.url} target="_blank" rel="noopener noreferrer">
											<span class="cu-src-n">{i + 1}</span>
											<span class="cu-src-t">{s.title}<small>{(() => { try { return new URL(s.url).hostname; } catch { return s.url; } })()}</small></span>
										</a>
										{#if s.snippet}<p>{s.snippet}</p>{/if}
									</li>
								{/each}
							</ol>
						{/if}
						{#if m.error}<p class="cu-error" role="alert">{m.error}</p>{/if}
						{#if m.role !== 'system' && !(streaming && m.id === lastAssistant)}
							<div class="cu-actions">
								{#if onVersion && m.versions && m.versions.length > 1}
									{@const vi = m.versionIndex ?? 0}
									<span class="cu-versions">
										<button type="button" class="cu-btn" aria-label={t.prevVersion} disabled={vi === 0 || streaming} onclick={() => onVersion(m, vi - 1)}>‹</button>
										<span>{vi + 1}/{m.versions.length}</span>
										<button type="button" class="cu-btn" aria-label={t.nextVersion} disabled={vi === m.versions.length - 1 || streaming} onclick={() => onVersion(m, vi + 1)}>›</button>
									</span>
								{/if}
								<button type="button" class="cu-btn" onclick={() => copy(m.id, m.content)}>{copied === m.id ? t.copied : t.copy}</button>
								{#if onRetry && m.role === 'assistant' && !streaming && (m.id === lastAssistant || m.error)}
									<button type="button" class="cu-btn" onclick={() => onRetry(m)}>{t.retry}</button>
								{/if}
								{#if onEdit && m.role === 'user' && !streaming}
									<button type="button" class="cu-btn" onclick={() => startEdit(m)}>{t.edit}</button>
								{/if}
								{#if m.role === 'assistant' && canSpeak && m.content}
									<button type="button" class="cu-btn" aria-pressed={speaking === m.id} onclick={() => speak(m)}>{speaking === m.id ? t.stopReading : t.readAloud}</button>
								{/if}
								{#if onFeedback && m.role === 'assistant'}
									<button type="button" class="cu-btn" aria-label={t.good} title={t.good} aria-pressed={m.feedback === 'up'} onclick={() => onFeedback(m, m.feedback === 'up' ? null : 'up')}>👍</button>
									<button type="button" class="cu-btn" aria-label={t.bad} title={t.bad} aria-pressed={m.feedback === 'down'} onclick={() => onFeedback(m, m.feedback === 'down' ? null : 'down')}>👎</button>
								{/if}
							</div>
						{/if}
						{#if m.followUps?.length && m.id === lastAssistant && !streaming && mi === messages.length - 1}
							<div class="cu-followups" role="group" aria-label={t.suggestions}>
								{#each m.followUps as f (f)}<button type="button" class="cu-chip" onclick={() => send(f)}>{f}</button>{/each}
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
						<li>
							<button type="button" class="cu-thumb" aria-label="{t.open} {f.name}" onclick={() => openFile(fileToPart(f))}>
								{#if f.type.startsWith('image/')}<img src={fileUrl({ blob: f })} alt="" />{:else}<span class="cu-fv-ext">{extOf(f.name).slice(1).toUpperCase() || 'FILE'}</span>{/if}
								<span>{f.name}</span>
							</button>
							<button type="button" class="cu-btn" aria-label="{t.remove} {f.name}" onclick={() => (files = files.filter((_, j) => j !== i))}>×</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="cu-row">
				{#if attachments}
					<input type="file" multiple {accept} hidden bind:this={fileInput} onchange={pick} />
					<button type="button" class="cu-btn cu-icon-btn" aria-label={t.attach} title={t.attach} onclick={() => fileInput?.click()}>+</button>
					{#if touch}
						<input type="file" accept="image/*" capture="environment" hidden bind:this={camInput} onchange={pick} />
						<button type="button" class="cu-btn cu-icon-btn" aria-label={t.camera} title={t.camera} onclick={() => camInput?.click()}>📷</button>
					{/if}
				{/if}
				<textarea class="cu-input" rows="1" bind:this={input} bind:value={text} onkeydown={keydown} onpaste={paste} placeholder={t.placeholder} aria-label={t.placeholder} aria-keyshortcuts="/"></textarea>
				{#if canListen}
					<button type="button" class="cu-btn cu-icon-btn" aria-label={t.voice} title={t.voice} aria-pressed={listening} onclick={listen}>🎤</button>
				{/if}
				{#if streaming}
					<button type="button" class="cu-btn cu-primary" aria-keyshortcuts="Escape" onclick={() => onStop?.()}>{t.stop}</button>
				{:else}
					<button type="submit" class="cu-btn cu-primary" disabled={!text.trim() && !files.length}>{t.send}</button>
				{/if}
			</div>
		</form>
		{#if dragging}<div class="cu-drop" aria-hidden="true">{t.dropFiles}</div>{/if}
	</div>

	{#if open.length}
		<PreviewPanel
			files={open}
			active={Math.min(tab, open.length - 1)}
			labels={t}
			{htmlSandbox}
			onselect={(i) => (tab = i)}
			onclosetab={(i) => ((open = open.filter((_, j) => j !== i)), (tab = Math.max(0, Math.min(tab, open.length - 1))))}
			onclose={() => (open = [])}
		/>
	{/if}
</div>

<style>
	/* Theme: set any --chat-* (bg, fg, card, soft, muted, line, primary, on-primary, bad, good, code-bg, code-fg, radius, font, mono, max) on an ancestor. Defaults follow the sergeantweb neutral grey theme. */
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
		--cu-good: var(--chat-good, oklch(0.55 0.14 150));
		--cu-code-bg: var(--chat-code-bg, oklch(0.22 0 0));
		--cu-code-fg: var(--chat-code-fg, oklch(0.93 0 0));
		--cu-radius: var(--chat-radius, 1rem);
		--cu-font: var(--chat-font, 'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
		--cu-mono: var(--chat-mono, ui-monospace, 'JetBrains Mono Variable', 'SFMono-Regular', Menlo, monospace);
		--cu-max: var(--chat-max, 48rem);
		color-scheme: light;
		position: relative;
		display: flex;
		height: 100%;
		min-height: 0;
		background: var(--cu-bg);
		color: var(--cu-fg);
		font-family: var(--cu-font);
		font-size: 15.5px;
		line-height: 1.65;
		font-feature-settings: 'cv11', 'ss01';
		-webkit-font-smoothing: antialiased;
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
			--cu-good: var(--chat-good, oklch(0.75 0.14 150));
			--cu-bad: var(--chat-bad, oklch(0.7 0.18 27));
			color-scheme: dark;
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
		--cu-good: var(--chat-good, oklch(0.75 0.14 150));
		--cu-bad: var(--chat-bad, oklch(0.7 0.18 27));
		color-scheme: dark;
	}
	.cu-main {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.cu-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--cu-line);
		flex-wrap: wrap;
	}
	.cu-grow {
		flex: 1;
	}
	.cu-muted,
	.cu :global(.cu-muted) {
		color: var(--cu-muted);
		font-size: 13px;
	}
	.cu-log {
		flex: 1;
		overflow-y: auto;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.cu-msg {
		width: 100%;
		max-width: var(--cu-max);
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cu-msg[hidden] {
		display: none;
	}
	.cu-user {
		align-items: flex-end;
	}
	.cu-user .cu-bubble,
	.cu :global(.cu-reply) {
		background: var(--cu-soft);
		border-radius: var(--cu-radius);
		padding: 8px 14px;
		max-width: 85%;
	}
	.cu :global(.cu-reply) {
		align-self: flex-end;
	}
	.cu-system .cu-bubble {
		color: var(--cu-muted);
		font-size: 13px;
		text-align: center;
		width: 100%;
	}
	.cu-text,
	.cu :global(.cu-text) {
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
	.cu-error,
	.cu :global(.cu-error) {
		margin: 0;
		color: var(--cu-bad);
		font-size: 13px;
	}
	.cu-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		opacity: 0.75;
	}
	.cu-msg:hover .cu-actions,
	.cu-actions:focus-within {
		opacity: 1;
	}
	.cu-versions {
		display: inline-flex;
		align-items: center;
		font-size: 12.5px;
		color: var(--cu-muted);
	}
	.cu :global(.cu-btn) {
		font: inherit;
		font-size: 12.5px;
		color: var(--cu-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.cu :global(.cu-btn:hover:not(:disabled)),
	.cu :global(.cu-btn[aria-pressed='true']) {
		background: var(--cu-soft);
		color: var(--cu-fg);
	}
	.cu :global(.cu-btn:disabled) {
		opacity: 0.4;
		cursor: default;
	}
	.cu :global(:is(button, a, input, select, textarea, summary, [tabindex]):focus-visible) {
		outline: 2px solid var(--cu-fg);
		outline-offset: 2px;
	}
	.cu :global(.cu-primary) {
		background: var(--cu-primary);
		color: var(--cu-on-primary);
		font-size: 14px;
		padding: 6px 16px;
	}
	.cu :global(.cu-primary:hover:not(:disabled)) {
		background: var(--cu-primary);
		color: var(--cu-on-primary);
		opacity: 0.9;
	}
	.cu-icon-btn {
		font-size: 16px;
		width: 34px;
		height: 34px;
		justify-content: center;
		padding: 0;
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
		justify-content: center;
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
	.cu-row,
	.cu :global(.cu-row) {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
		align-items: center;
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
		display: flex;
		align-items: center;
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: 10px;
		padding: 3px;
	}
	.cu-thumb {
		all: unset;
		display: flex;
		align-items: center;
		gap: 8px;
		padding-right: 6px;
		cursor: pointer;
		max-width: 220px;
	}
	.cu-thumb span:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cu-thumb img,
	.cu :global(.cu-fv-ext) {
		width: 40px;
		height: 40px;
		border-radius: 7px;
		object-fit: cover;
		flex: none;
	}
	.cu :global(.cu-fv-ext) {
		display: grid;
		place-items: center;
		background: var(--cu-soft);
		color: var(--cu-muted);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.cu-pending {
		margin: 0 0 8px;
	}
	.cu-drop {
		position: absolute;
		inset: 8px;
		display: grid;
		place-items: center;
		border: 2px dashed var(--cu-muted);
		border-radius: var(--cu-radius);
		background: color-mix(in oklch, var(--cu-bg) 85%, transparent);
		font-weight: 600;
		pointer-events: none;
	}
	.cu-starters {
		margin: auto;
		max-width: var(--cu-max);
		width: 100%;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 10px;
	}
	.cu-starter,
	.cu-chip {
		font: inherit;
		color: inherit;
		text-align: left;
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: var(--cu-radius);
		padding: 12px 14px;
		cursor: pointer;
	}
	.cu-chip {
		font-size: 13.5px;
		border-radius: 999px;
		padding: 5px 12px;
	}
	.cu-starter:hover,
	.cu-chip:hover {
		background: var(--cu-soft);
	}
	.cu-followups {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.cu-reasoning,
	.cu-tool {
		border: 1px solid var(--cu-line);
		border-radius: calc(var(--cu-radius) * 0.75);
		padding: 6px 12px;
		font-size: 13.5px;
		color: var(--cu-muted);
	}
	.cu-reasoning summary,
	.cu-tool summary {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cu-reasoning p {
		margin: 6px 0;
		border-left: 2px solid var(--cu-line);
		padding-left: 10px;
	}
	.cu-tool-name {
		flex: 1;
		color: var(--cu-fg);
	}
	.cu-tool pre {
		font-family: var(--cu-mono);
		font-size: 12.5px;
		background: var(--cu-soft);
		border-radius: 8px;
		padding: 8px 10px;
		margin: 2px 0 8px;
		overflow-x: auto;
		max-height: 300px;
	}
	.cu-tool p {
		margin: 6px 0 2px;
	}
	.cu-badge {
		font-size: 11.5px;
		border-radius: 999px;
		padding: 1px 8px;
		background: var(--cu-soft);
	}
	.cu-tool-running .cu-badge {
		animation: cu-pulse 1.4s ease-in-out infinite;
	}
	.cu-tool-done .cu-badge {
		color: var(--cu-good);
	}
	.cu-tool-error .cu-badge {
		color: var(--cu-bad);
	}
	.cu-sources {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px;
	}
	.cu-sources li {
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: calc(var(--cu-radius) * 0.75);
		padding: 8px 10px;
		font-size: 13px;
	}
	.cu-sources a {
		display: flex;
		gap: 8px;
		color: inherit;
		text-decoration: none;
	}
	.cu-sources p {
		margin: 4px 0 0;
		color: var(--cu-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.cu-src-n,
	.cu-md :global(.cu-cite) {
		display: inline-grid;
		place-items: center;
		min-width: 1.5em;
		height: 1.5em;
		border-radius: 999px;
		background: var(--cu-soft);
		font-size: 11px;
		font-weight: 600;
		flex: none;
	}
	.cu-md :global(.cu-cite) {
		text-decoration: none;
		vertical-align: 0.15em;
		margin: 0 1px;
	}
	.cu-src-t {
		display: flex;
		flex-direction: column;
		font-weight: 500;
	}
	.cu small,
	.cu :global(small) {
		display: block;
		font-weight: 400;
		color: var(--cu-muted);
		font-size: 12px;
	}
	/* Files */
	.cu-file {
		margin: 0;
		border: 1px solid var(--cu-line);
		border-radius: calc(var(--cu-radius) * 0.75);
		background: var(--cu-card);
		overflow: hidden;
	}
	.cu-file figcaption {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px 4px 12px;
		font-size: 13px;
		border-bottom: 1px solid var(--cu-line);
	}
	.cu-file-name {
		flex: 1;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cu-file-open {
		all: unset;
		display: block;
		padding: 24px;
		text-align: center;
		cursor: pointer;
		color: var(--cu-muted);
		width: 100%;
		box-sizing: border-box;
	}
	.cu :global(.cu-fv) {
		display: block;
	}
	.cu :global(.cu-fv-inline) {
		max-height: 360px;
		overflow: auto;
	}
	.cu :global(.cu-fv img),
	.cu :global(.cu-fv video) {
		display: block;
		max-width: 100%;
		margin: 0 auto;
		transform-origin: top center;
		transition: transform 0.15s;
	}
	.cu :global(.cu-fv-inline img) {
		max-height: 320px;
		width: auto;
	}
	.cu :global(.cu-fv-zoom) {
		overflow: auto;
	}
	.cu :global(.cu-fv audio) {
		width: 100%;
		display: block;
		padding: 8px;
		box-sizing: border-box;
	}
	.cu :global(.cu-fv iframe) {
		width: 100%;
		height: 100%;
		min-height: 60vh;
		border: 0;
		background: #fff;
	}
	.cu :global(.cu-fv-code) {
		margin: 0;
		padding: 12px 14px;
		font-family: var(--cu-mono);
		font-size: 13px;
		line-height: 1.5;
		background: var(--cu-code-bg);
		color: var(--cu-code-fg);
		overflow: auto;
		min-height: 100%;
		box-sizing: border-box;
	}
	.cu :global(.cu-fv-card) {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
	}
	.cu :global(.cu-fv-card > span:nth-child(2)) {
		flex: 1;
		overflow-wrap: anywhere;
	}
	.cu :global(.cu-fv-markdown) {
		padding: 12px 16px;
	}
	.cu :global(.cu-fv-loading) {
		padding: 16px;
		color: var(--cu-muted);
	}
	.cu :global(.cu-dt) {
		padding: 8px;
	}
	.cu :global(.cu-dt-scroll) {
		overflow: auto;
		max-height: 60vh;
	}
	.cu :global(.cu-dt-count) {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--cu-muted);
		text-align: right;
	}
	.cu :global(:is(.cu-dt, .cu-md) table) {
		border-collapse: collapse;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}
	.cu :global(:is(.cu-dt, .cu-md) :is(th, td)) {
		border-bottom: 1px solid var(--cu-line);
		padding: 6px 12px;
		text-align: left;
	}
	.cu :global(:is(.cu-dt, .cu-md) th) {
		position: sticky;
		top: 0;
		background: var(--cu-bg);
		font-weight: 600;
	}
	.cu :global(.cu-sort) {
		all: unset;
		cursor: pointer;
		font-weight: 600;
	}
	.cu :global(.cu-sort::after) {
		content: ' ↕';
		color: var(--cu-muted);
		font-weight: 400;
	}
	.cu :global([aria-sort='ascending'] .cu-sort::after) {
		content: ' ↑';
	}
	.cu :global([aria-sort='descending'] .cu-sort::after) {
		content: ' ↓';
	}
	.cu :global(.cu-filter) {
		font: inherit;
		font-size: 13px;
		color: inherit;
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: 999px;
		padding: 4px 12px;
		margin: 0 0 6px;
		min-width: 0;
		max-width: 260px;
	}
	.cu :global(.cu-tools) {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.cu :global(.cu-sr) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	/* Preview panel */
	.cu :global(.cu-panel) {
		width: min(50%, 720px);
		flex: none;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--cu-line);
		background: var(--cu-card);
		outline: none;
		min-height: 0;
	}
	.cu :global(.cu-panel.cu-full) {
		position: absolute;
		inset: 0;
		width: auto;
		z-index: 2;
	}
	@media (max-width: 720px) {
		.cu :global(.cu-panel) {
			position: absolute;
			inset: 0;
			width: auto;
			z-index: 2;
		}
	}
	.cu :global(.cu-tabs) {
		display: flex;
		overflow-x: auto;
		border-bottom: 1px solid var(--cu-line);
	}
	.cu :global(.cu-tab) {
		display: flex;
		align-items: center;
		border-right: 1px solid var(--cu-line);
		font-size: 13px;
		flex: none;
	}
	.cu :global(.cu-tab [role='tab']) {
		all: unset;
		cursor: pointer;
		padding: 8px 4px 8px 12px;
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--cu-muted);
	}
	.cu :global(.cu-tab.cu-on) {
		background: var(--cu-bg);
	}
	.cu :global(.cu-tab.cu-on [role='tab']) {
		color: var(--cu-fg);
		font-weight: 500;
	}
	.cu :global(.cu-panel-bar) {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--cu-line);
		font-size: 13px;
	}
	.cu :global(.cu-panel-bar select),
	.cu :global(.cu-ask select) {
		font: inherit;
		color: inherit;
		background: var(--cu-card);
		border: 1px solid var(--cu-line);
		border-radius: 8px;
		padding: 3px 6px;
	}
	.cu :global(.cu-panel-body) {
		flex: 1;
		overflow: auto;
		min-height: 0;
	}
	.cu :global(.cu-panel-body > .cu-fv) {
		height: 100%;
	}
	/* Ask (forms in chat) */
	.cu :global(.cu-ask) {
		border: 1px solid var(--cu-line);
		border-radius: var(--cu-radius);
		background: var(--cu-card);
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.cu :global(.cu-ask-title) {
		margin: 0;
		font-weight: 600;
	}
	.cu :global(.cu-ask fieldset) {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.cu :global(.cu-ask legend) {
		padding: 0;
		margin-bottom: 8px;
		font-weight: 500;
	}
	.cu :global(.cu-ask-help) {
		margin: 0;
		font-size: 13px;
		color: var(--cu-muted);
	}
	.cu :global(.cu-ask :is(input[type='text'], input[type='number'], input[type='date'], textarea)) {
		font: inherit;
		color: inherit;
		background: var(--cu-bg);
		border: 1px solid var(--cu-line);
		border-radius: 10px;
		padding: 7px 10px;
	}
	.cu :global(.cu-ask input[type='range']) {
		flex: 1;
		accent-color: var(--cu-primary);
	}
	.cu :global(.cu-ask .cu-invalid :is(input, textarea, select)) {
		border-color: var(--cu-bad);
	}
	.cu :global(.cu-ask-buttons) {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.cu :global(.cu-choice) {
		font: inherit;
		color: inherit;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		background: var(--cu-bg);
		border: 1px solid var(--cu-line);
		border-radius: 12px;
		padding: 8px 14px;
		cursor: pointer;
	}
	.cu :global(.cu-choice:hover),
	.cu :global(.cu-choice[aria-pressed='true']) {
		border-color: var(--cu-fg);
	}
	.cu :global(.cu-choice img) {
		width: 40px;
		height: 40px;
		object-fit: cover;
		border-radius: 8px;
	}
	.cu :global(.cu-icon) {
		font-size: 1.25em;
	}
	.cu :global(.cu-opt) {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		cursor: pointer;
	}
	.cu :global(.cu-opt input) {
		margin-top: 0.35em;
		accent-color: var(--cu-primary);
	}
	.cu :global(.cu-rating) {
		display: flex;
		gap: 2px;
		font-size: 26px;
		line-height: 1;
	}
	.cu :global(.cu-rating label) {
		cursor: pointer;
		color: var(--cu-line);
	}
	.cu :global(.cu-rating label.cu-on) {
		color: var(--cu-fg);
	}
	.cu :global(.cu-rating input) {
		position: absolute;
		opacity: 0;
		width: 1px;
	}
	.cu :global(.cu-rating label:focus-within) {
		outline: 2px solid var(--cu-fg);
		border-radius: 4px;
	}
	.cu :global(.cu-ask-progress) {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		color: var(--cu-muted);
	}
	.cu :global(.cu-ask-progress progress) {
		flex: 1;
		height: 6px;
		accent-color: var(--cu-primary);
	}
	.cu :global(.cu-ask-done) {
		margin: 0;
		padding-left: 18px;
		color: var(--cu-muted);
		font-size: 14px;
	}
	.cu :global(.cu-ok) {
		color: var(--cu-good);
		margin-left: 6px;
	}
	.cu :global(.cu-ko) {
		color: var(--cu-bad);
		margin-left: 6px;
	}
	/* Markdown: a calm reading scale, generous spacing. */
	.cu :global(.cu-md) {
		overflow-wrap: anywhere;
	}
	.cu :global(.cu-md > *) {
		margin: 0 0 0.85em;
	}
	.cu :global(.cu-md > :last-child) {
		margin-bottom: 0;
	}
	.cu :global(.cu-md :is(h1, h2, h3, h4)) {
		line-height: 1.3;
		letter-spacing: -0.01em;
		margin: 1.4em 0 0.5em;
		font-weight: 650;
	}
	.cu :global(.cu-md > :first-child) {
		margin-top: 0;
	}
	.cu :global(.cu-md h1) {
		font-size: 1.5em;
	}
	.cu :global(.cu-md h2) {
		font-size: 1.28em;
	}
	.cu :global(.cu-md h3) {
		font-size: 1.1em;
	}
	.cu :global(.cu-md h4) {
		font-size: 1em;
	}
	.cu :global(.cu-md :is(ul, ol)) {
		padding-left: 1.4em;
	}
	.cu :global(.cu-md li + li) {
		margin-top: 0.25em;
	}
	.cu :global(.cu-md li:has(> input[type='checkbox'])) {
		list-style: none;
		margin-left: -1.3em;
	}
	.cu :global(.cu-md input[type='checkbox']) {
		accent-color: var(--cu-primary);
		margin-right: 0.4em;
	}
	.cu :global(.cu-md hr) {
		border: 0;
		border-top: 1px solid var(--cu-line);
		margin: 1.5em 0;
	}
	.cu :global(.cu-md a) {
		color: inherit;
		text-underline-offset: 3px;
	}
	.cu :global(.cu-md :not(pre) > code) {
		font-family: var(--cu-mono);
		font-size: 0.88em;
		background: var(--cu-soft);
		border-radius: 6px;
		padding: 1px 5px;
	}
	.cu :global(.cu-md table) {
		display: block;
		overflow-x: auto;
	}
	.cu :global(.cu-md blockquote) {
		margin-left: 0;
		padding-left: 12px;
		border-left: 3px solid var(--cu-line);
		color: var(--cu-muted);
	}
	.cu :global(.cu-md details) {
		border: 1px solid var(--cu-line);
		border-radius: calc(var(--cu-radius) * 0.75);
		padding: 8px 12px;
	}
	.cu :global(.cu-md summary) {
		cursor: pointer;
		font-weight: 500;
	}
	.cu :global(.cu-callout) {
		border-left: 3px solid var(--cu-muted);
		background: var(--cu-soft);
		border-radius: 0 10px 10px 0;
		padding: 10px 14px;
	}
	.cu :global(.cu-callout > p) {
		margin: 0 0 0.4em;
	}
	.cu :global(.cu-callout > :last-child) {
		margin-bottom: 0;
	}
	.cu :global(.cu-callout-title) {
		font-weight: 600;
		font-size: 0.9em;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.cu :global(.cu-warning),
	.cu :global(.cu-caution) {
		border-left-color: var(--cu-bad);
	}
	.cu :global(.cu-tip) {
		border-left-color: var(--cu-good);
	}
	.cu :global(.cu-important) {
		border-left-color: var(--cu-fg);
	}
	.cu :global(.cu-footnotes) {
		font-size: 0.88em;
		color: var(--cu-muted);
		border-top: 1px solid var(--cu-line);
		padding-top: 0.5em;
	}
	.cu :global(.cu-fn-ref a) {
		text-decoration: none;
		padding: 0 2px;
	}
	.cu :global(.cu-svg svg),
	.cu :global(.cu-block svg) {
		max-width: 100%;
		height: auto;
	}
	.cu :global(div.cu-block) {
		overflow-x: auto;
		text-align: center;
	}
	.cu :global(.cu-block[data-cu-block='lottie']) {
		max-width: 240px;
		margin-inline: auto;
	}
	.cu :global(.cu-block > pre),
	.cu :global(.cu-block > code) {
		text-align: left;
		color: var(--cu-muted);
		font-family: var(--cu-mono);
		font-size: 13px;
	}
	.cu :global(.cu-md .cu-code) {
		background: var(--cu-code-bg);
		color: var(--cu-code-fg);
		border-radius: calc(var(--cu-radius) * 0.75);
		margin: 12px 0;
		overflow: hidden;
	}
	.cu :global(.cu-md .cu-code-bar) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 8px 4px 14px;
		font-size: 12px;
		opacity: 0.8;
	}
	.cu :global(.cu-md .cu-code .cu-btn) {
		color: inherit;
	}
	.cu :global(.cu-md .cu-code .cu-btn:hover) {
		background: oklch(1 0 0 / 12%);
	}
	.cu :global(.cu-md .cu-code pre) {
		margin: 0;
		padding: 0 14px 14px;
		overflow-x: auto;
		font-family: var(--cu-mono);
		font-size: 13px;
		line-height: 1.5;
	}
	/* highlight.js tokens, tuned for the dark code background */
	.cu :global(:is(.hljs-keyword, .hljs-built_in, .hljs-selector-tag)) {
		color: oklch(0.78 0.12 300);
	}
	.cu :global(:is(.hljs-string, .hljs-attr, .hljs-template-variable)) {
		color: oklch(0.82 0.12 145);
	}
	.cu :global(:is(.hljs-number, .hljs-literal)) {
		color: oklch(0.82 0.12 65);
	}
	.cu :global(.hljs-comment) {
		color: oklch(0.65 0 0);
		font-style: italic;
	}
	.cu :global(:is(.hljs-title, .hljs-function, .hljs-type)) {
		color: oklch(0.8 0.1 230);
	}
	@media (max-width: 600px) {
		.cu {
			font-size: 15px;
		}
		.cu-log {
			padding: 16px 12px;
			gap: 22px;
		}
		.cu-composer {
			padding: 0 8px 8px;
		}
		.cu-user .cu-bubble {
			max-width: 92%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cu :global(*),
		.cu :global(*::before),
		.cu :global(*::after) {
			animation-duration: 0.001ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.001ms !important;
		}
	}
</style>
