// Rich block renderers for fenced code (```mermaid, ```math, ```lottie, or your own) and $inline$/$$display$$ math.
// The library ships none of the heavy engines: you hand it a loader, so they load on first use and only if you want them.
import DOMPurify from 'dompurify';

export type BlockRenderer = (el: HTMLElement, source: string, opts: { display: boolean; dark: boolean }) => void | Promise<void>;

const blocks = new Map<string, BlockRenderer>();

/** Renders ```lang fences with `render` instead of a code block. 'math' also handles $...$ and $$...$$. */
export function registerBlock(lang: string, render: BlockRenderer): () => void {
	blocks.set(lang, render);
	return () => blocks.get(lang) === render && blocks.delete(lang);
}
export const hasBlock = (lang: string) => blocks.has(lang);

const cache = new Map<string, string>();
let n = 0;

/** Renders every pending [data-cu-block] under root. Static output is cached, so streaming re-renders stay cheap. */
export async function renderBlocks(root: HTMLElement) {
	const dark = !!root.closest('.cu') && getComputedStyle(root).getPropertyValue('color-scheme').includes('dark');
	for (const el of root.querySelectorAll<HTMLElement>('[data-cu-block]:not([data-done])')) {
		const lang = el.dataset.cuBlock!;
		const render = blocks.get(lang);
		if (!render) continue;
		el.dataset.done = '1';
		const src = decodeURIComponent(el.dataset.src ?? ''); // encoded: DOMPurify drops attribute values containing '-->'
		const display = el.tagName !== 'SPAN';
		const key = `${lang}${display}${dark}\0${src}`;
		const hit = cache.get(key);
		if (hit != null) {
			el.innerHTML = hit;
			continue;
		}
		try {
			await render(el, src, { display, dark });
			if (el.dataset.live == null) cache.set(key, el.innerHTML);
		} catch {
			el.removeAttribute('data-done'); // ponytail: an unfinished (streaming) source fails; retried on the next render.
		}
	}
}

const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Mermaid labels are HTML inside <foreignObject>.
const sanitizeSvg = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true } });

/** ```mermaid diagrams. `registerBlock('mermaid', mermaidBlock(() => import('mermaid')))` */
export const mermaidBlock =
	(load: () => Promise<{ default: { initialize(c: object): void; render(id: string, src: string): Promise<{ svg: string }> } }>): BlockRenderer =>
	async (el, src, { dark }) => {
		const m = (await load()).default;
		m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral' });
		const { svg } = await m.render(`cu-mmd-${++n}`, src);
		el.innerHTML = sanitizeSvg(svg);
	};

/** ```math / $...$ via KaTeX. Load katex/dist/katex.min.css too: `katexBlock(() => import('katex'))`. */
export const katexBlock =
	(load: () => Promise<{ default: { renderToString(src: string, o: object): string } }>): BlockRenderer =>
	async (el, src, { display }) => {
		const k = (await load()).default;
		el.innerHTML = k.renderToString(src, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
	};

/** ```lottie with the animation JSON. Paused under prefers-reduced-motion. `lottieBlock(() => import('lottie-web'))` */
export const lottieBlock =
	(load: () => Promise<{ default: { loadAnimation(o: object): unknown } }>): BlockRenderer =>
	async (el, src) => {
		const data = JSON.parse(src);
		const lottie = (await load()).default;
		el.dataset.live = '';
		el.innerHTML = '';
		el.setAttribute('role', 'img');
		el.setAttribute('aria-label', data.nm ?? 'Animation');
		lottie.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: !reduced(), animationData: data });
	};

/** Pauses SVG SMIL animations when the user prefers reduced motion (CSS animations are handled in the stylesheet). */
export function pauseSvgAnimations(root: HTMLElement) {
	if (reduced()) for (const svg of root.querySelectorAll('svg')) svg.pauseAnimations?.();
}
