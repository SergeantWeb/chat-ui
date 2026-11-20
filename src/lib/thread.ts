// Pure helpers over the messages array: branching (keep old answers on retry/edit), export, search.
import type { ChatMessage, MessageVersion } from './types.js';

const strip = ({ versions: _v, versionIndex: _i, ...m }: ChatMessage): Omit<ChatMessage, 'versions' | 'versionIndex'> => m;
const unwrap = ({ tail: _t, ...m }: MessageVersion): ChatMessage => m;

/** Snapshot of every version of messages[i], with the current one refreshed from the live thread. */
function saved(messages: ChatMessage[], i: number): { all: MessageVersion[]; cur: number } {
	const m = messages[i];
	const all = [...(m.versions ?? [])];
	const cur = m.versionIndex ?? 0;
	all[cur] = { ...strip(m), tail: messages.slice(i + 1) };
	return { all, cur };
}

/** Replaces messages[i] (and drops what follows) with `next`, keeping the old one as a version.
 *  Retry: `messages = branch(messages, i, { id, role: 'assistant', content: '' })`. Edit: same with the edited user message. */
export function branch(messages: ChatMessage[], i: number, next: ChatMessage): ChatMessage[] {
	const { all } = saved(messages, i);
	all.push({ ...strip(next), tail: [] });
	return [...messages.slice(0, i), { ...strip(next), versions: all, versionIndex: all.length - 1 }];
}

/** Shows version k of messages[i], with the thread that followed it. */
export function switchVersion(messages: ChatMessage[], i: number, k: number): ChatMessage[] {
	const { all } = saved(messages, i);
	const v = all[k];
	if (!v) return messages;
	return [...messages.slice(0, i), { ...unwrap(v), versions: all, versionIndex: k }, ...v.tail];
}

/** The visible thread as Markdown. */
export const toMarkdown = (messages: ChatMessage[]) =>
	messages
		.filter((m) => m.content || m.parts?.length)
		.map((m) => {
			const parts = (m.parts ?? []).map((p) => (p.type === 'text' ? p.text : p.type === 'file' ? `[${p.name}](${p.url ?? p.name})` : '')).filter(Boolean);
			const src = m.sources?.length ? '\n\n' + m.sources.map((s, i) => `[${i + 1}]: ${s.url} "${s.title}"`).join('\n') : '';
			return `**${m.role}**\n\n${[m.content, ...parts].filter(Boolean).join('\n\n')}${src}`;
		})
		.join('\n\n---\n\n');

/** The thread as JSON (blobs and versions dropped). */
export const toJSON = (messages: ChatMessage[]) =>
	JSON.stringify(
		messages.map(strip),
		(k, v) => (v instanceof Blob ? undefined : v),
		2
	);

/** Ids of messages whose text contains q (case- and accent-insensitive). */
export function searchMessages(messages: ChatMessage[], q: string): Set<string> {
	const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
	const n = norm(q.trim());
	return new Set(messages.filter((m) => !n || norm([m.content, m.reasoning ?? '', ...(m.parts ?? []).map((p) => (p.type === 'text' ? p.text : ''))].join(' ')).includes(n)).map((m) => m.id));
}

/** Triggers a browser download of text. */
export function download(name: string, data: string | Blob, type = 'text/plain') {
	const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
	const a = Object.assign(document.createElement('a'), { href: url, download: name });
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
