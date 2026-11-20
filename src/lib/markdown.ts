// Markdown -> sanitized HTML for chat messages. marked parses, DOMPurify sanitizes (model output is untrusted),
// highlight.js colours code once loaded (lazily, on the first code block, so pages without code never pay for it).
// Extras: callouts (> [!NOTE]), footnotes ([^1]), citations ([1] with sources), $math$, ```svg, and placeholders
// for registered block renderers (```mermaid, ```math, ```lottie...) that blocks.ts fills in after render.
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import { hasBlock } from './blocks.js';
import type { Source } from './types.js';

type Hljs = typeof import('highlight.js').default;
let hljs: Hljs | null = null;
let loading: Promise<Hljs> | null = null;

/** Loads highlight.js (common languages). Resolves once; later renders are highlighted synchronously. */
export function loadHighlighter(): Promise<Hljs> {
	return (loading ??= import('highlight.js/lib/common').then((m) => (hljs = m.default)));
}

/** Highlighted HTML for code (escaped plain text until highlight.js is loaded). */
export function highlight(text: string, language = ''): string {
	if (hljs && language && hljs.getLanguage(language)) return hljs.highlight(text, { language, ignoreIllegals: true }).value;
	return esc(text);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let sources: Source[] | undefined; // set for the duration of one synchronous parse

const math: TokenizerAndRendererExtension[] = [
	{
		name: 'mathBlock',
		level: 'block',
		start: (s) => s.indexOf('$$'),
		tokenizer(src) {
			const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
			if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
		},
		renderer: (t) => `<div class="cu-block" data-cu-block="math" data-src="${encodeURIComponent(t.text)}"><code>${esc(t.text)}</code></div>`
	},
	{
		name: 'mathInline',
		level: 'inline',
		start: (s) => s.indexOf('$'),
		tokenizer(src) {
			// $x$ but not "$5 and $10": no space inside the delimiters, no digit right after the closing one.
			const m = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
			if (m && hasBlock('math')) return { type: 'mathInline', raw: m[0], text: m[1] };
		},
		renderer: (t) => `<span class="cu-block" data-cu-block="math" data-src="${encodeURIComponent(t.text)}"><code>${esc(t.text)}</code></span>`
	},
	{
		name: 'cite',
		level: 'inline',
		start: (s) => s.indexOf('['),
		tokenizer(src) {
			const m = /^\[(\d{1,3})\](?![(:[])/.exec(src);
			const s = m && sources?.[Number(m[1]) - 1];
			if (m && s) return { type: 'cite', raw: m[0], n: m[1], title: s.title, href: s.url };
		},
		renderer: (t) => `<a class="cu-cite" href="${esc(t.href)}" title="${esc(t.title)}" target="_blank" rel="noopener noreferrer">${t.n}</a>`
	}
];

const CALLOUT = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i;

const marked = new Marked({
	gfm: true,
	breaks: true,
	extensions: math,
	renderer: {
		code({ text, lang }: Tokens.Code) {
			const language = (lang ?? '').trim().split(/\s/)[0] ?? '';
			if (language === 'svg') return `<div class="cu-svg">${text}</div>`; // sanitized with everything else
			if (hasBlock(language))
				return `<div class="cu-block" data-cu-block="${esc(language)}" data-src="${encodeURIComponent(text)}"><pre><code>${esc(text)}</code></pre></div>`;
			if (!hljs) void loadHighlighter();
			const known = hljs && language && hljs.getLanguage(language);
			// The copy button is wired by the Chat component through event delegation (data-copy-code).
			return `<div class="cu-code"><div class="cu-code-bar"><span>${esc(language || 'text')}</span><button type="button" class="cu-btn" data-copy-code aria-label="Copy code">Copy</button></div><pre><code class="hljs${known ? ' language-' + esc(language) : ''}">${highlight(text, language)}</code></pre></div>`;
		},
		link({ href, title, tokens }: Tokens.Link) {
			return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
		},
		blockquote({ tokens }: Tokens.Blockquote) {
			const body = this.parser.parse(tokens);
			const m = CALLOUT.exec(body);
			if (!m) return `<blockquote>${body}</blockquote>`;
			const kind = m[1].toLowerCase();
			return `<aside class="cu-callout cu-${kind}" role="note"><p class="cu-callout-title">${kind[0].toUpperCase() + kind.slice(1)}</p><p>${body.slice(m[0].length)}</aside>`;
		}
	}
});

/** Footnotes: "[^id]: text" lines become a numbered list at the end, "[^id]" references become links to them. */
function footnotes(src: string): string {
	const defs = new Map<string, string>();
	const body = src.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.+)$/gm, (_, id, text) => (defs.set(id, text), ''));
	if (!defs.size) return src;
	const order: string[] = [];
	const out = body.replace(/\[\^([^\]\s]+)\](?!:)/g, (all, id) => {
		if (!defs.has(id)) return all;
		if (!order.includes(id)) order.push(id);
		const n = order.indexOf(id) + 1;
		return `<sup class="cu-fn-ref"><a href="#cu-fn-${esc(id)}" id="cu-fnref-${esc(id)}">${n}</a></sup>`;
	});
	const list = order.map((id) => `<li id="cu-fn-${esc(id)}">${defs.get(id)} <a href="#cu-fnref-${esc(id)}" aria-label="Back">↩</a></li>`).join('\n');
	return `${out}\n\n<section class="cu-footnotes">\n<ol>\n${list}\n</ol>\n</section>\n`;
}

let hooked = false;
function hook() {
	if (hooked) return;
	hooked = true;
	// SMIL animations are allowed for simple animated SVGs, but never on href-like attributes (javascript: URLs).
	DOMPurify.addHook('uponSanitizeElement', (node, data) => {
		if (/^(animate|set)$/i.test(data.tagName) && /href/i.test((node as Element).getAttribute?.('attributeName') ?? '')) node.parentNode?.removeChild(node);
	});
}

/** Renders a (possibly still streaming, so unfinished) Markdown string to safe HTML. Pass `sources` to turn [n] into citation links. */
export function renderMarkdown(src: string, opts: { sources?: Source[] } = {}): string {
	if (typeof window === 'undefined') return esc(src); // SSR: no DOM for DOMPurify; the client re-renders.
	hook();
	sources = opts.sources;
	let html: string;
	try {
		html = marked.parse(footnotes(src), { async: false }) as string;
	} finally {
		sources = undefined;
	}
	return DOMPurify.sanitize(html, {
		ADD_TAGS: ['animate', 'animateTransform', 'animateMotion'],
		ADD_ATTR: ['target', 'data-copy-code', 'data-cu-block', 'data-src', 'attributeName', 'dur', 'repeatCount', 'values', 'keyTimes', 'from', 'to', 'begin'],
		FORBID_TAGS: ['style', 'form']
	});
}

/** True once highlight.js is loaded (for components to re-render). */
export const highlighterReady = () => hljs !== null;
