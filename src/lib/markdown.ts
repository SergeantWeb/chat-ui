// Markdown -> sanitized HTML for chat messages. marked parses, DOMPurify sanitizes (model output is untrusted),
// highlight.js colours code once loaded (lazily, on the first code block, so pages without code never pay for it).
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

type Hljs = typeof import('highlight.js').default;
let hljs: Hljs | null = null;
let loading: Promise<Hljs> | null = null;

/** Loads highlight.js (common languages). Resolves once; later renders are highlighted synchronously. */
export function loadHighlighter(): Promise<Hljs> {
	return (loading ??= import('highlight.js/lib/common').then((m) => (hljs = m.default)));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		code({ text, lang }: Tokens.Code) {
			const language = (lang ?? '').trim().split(/\s/)[0] ?? '';
			if (!hljs) void loadHighlighter();
			const known = hljs && language && hljs.getLanguage(language);
			const body = known ? hljs!.highlight(text, { language, ignoreIllegals: true }).value : esc(text);
			// The copy button is wired by the Chat component through event delegation (data-copy-code).
			return `<div class="cu-code"><div class="cu-code-bar"><span>${esc(language || 'text')}</span><button type="button" class="cu-btn" data-copy-code aria-label="Copy code">Copy</button></div><pre><code class="hljs${known ? ' language-' + esc(language) : ''}">${body}</code></pre></div>`;
		},
		link({ href, title, text }: Tokens.Link) {
			return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
		}
	}
});

/** Renders a (possibly still streaming, so unfinished) Markdown string to safe HTML. */
export function renderMarkdown(src: string): string {
	const html = marked.parse(src, { async: false }) as string;
	if (typeof window === 'undefined') return esc(src); // SSR: no DOM for DOMPurify; the client re-renders.
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy-code'] });
}

/** True once highlight.js is loaded (for components to re-render). */
export const highlighterReady = () => hljs !== null;
