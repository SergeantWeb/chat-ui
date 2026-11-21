# @sergeantweb/chat-ui

[Documentation](https://docs.sergeantweb.com/open-source/chat-ui) · [Previewing generated files](https://docs.sergeantweb.com/open-source/previewing-generated-files) · [npm](https://www.npmjs.com/package/@sergeantweb/chat-ui) · [Issues](https://github.com/SergeantWeb/chat-ui/issues)

A ChatGPT-like chat UI for **Svelte 5**. One component, three small dependencies, no CSS framework.

- Streaming Markdown (GFM tables, quotes, lists), sanitized with DOMPurify
- Code blocks with syntax highlighting (highlight.js, loaded lazily on the first code block) and a Copy button
- Message actions: copy, retry/regenerate, edit and resubmit
- Stop button while streaming
- Auto-growing composer: Enter sends, Shift+Enter adds a line (IME-safe)
- Rich answers: callouts (`> [!NOTE]`), collapsible `<details>`, task lists, footnotes, citations with source cards,
  sortable/filterable tables and lists, animated inline SVG, and lazy Mermaid / KaTeX / Lottie through `registerBlock`
- Message parts: generated files previewed inline (image, video, audio, PDF, code, CSV/JSON as a table, Markdown,
  sandboxed HTML, SVG, download card), tool-call cards, and interactive "ask" parts (forms, quizzes, wizards)
- Preview panel with tabs, zoom, copy/download, versions; `registerPreviewer` for your own file types
- Attachments of any type: picker, drag & drop, paste, camera on phones, thumbnails
- Reasoning block, starter prompts, follow-up chips, thumbs up/down, branching (`< 2/3 >`), read aloud and
  dictation (Web Speech API, feature-detected), search and Markdown/JSON export
- Shortcuts: Esc stops, `/` focuses the composer, ↑ edits your last message, Ctrl/Cmd+Shift+C copies the last answer
- Follows the stream, stops following when you scroll up, scroll-to-bottom button
- Accessible: `role="log"` live region, labelled controls, visible focus, reduced motion
- Themed with CSS variables, light and dark
- Transport-agnostic: you own the messages array; helpers for SSE (`readSSE`) and WebSocket (`websocketStore`)

MIT licensed.

## Install

Full guide: [docs.sergeantweb.com/open-source/chat-ui](https://docs.sergeantweb.com/open-source/chat-ui).

```sh
npm i @sergeantweb/chat-ui
```

## Usage

```svelte
<script lang="ts">
  import { Chat, readSSE, type ChatMessage } from '@sergeantweb/chat-ui';

  let messages = $state<ChatMessage[]>([]);
  let streaming = $state(false);
  let ctrl: AbortController | null = null;

  async function ask() {
    messages.push({ id: crypto.randomUUID(), role: 'assistant', content: '' });
    const reply = messages.at(-1)!;
    streaming = true;
    ctrl = new AbortController();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: messages.slice(0, -1) }),
        signal: ctrl.signal
      });
      for await (const e of readSSE(res, ctrl.signal)) reply.content += JSON.parse(e.data).text;
    } catch (err) {
      if (!ctrl.signal.aborted) reply.error = String(err);
    } finally {
      streaming = false;
    }
  }
</script>

<div style="height: 100dvh">
  <Chat
    {messages}
    {streaming}
    attachments
    onSend={(text, files) => {
      messages.push({ id: crypto.randomUUID(), role: 'user', content: text, attachments: files.map((f) => ({ name: f.name })) });
      ask();
    }}
    onStop={() => ctrl?.abort()}
    onRetry={(m) => {
      messages.splice(messages.findIndex((x) => x.id === m.id));
      ask();
    }}
    onEdit={(m, text) => {
      const i = messages.findIndex((x) => x.id === m.id);
      messages.splice(i, messages.length - i, { ...m, content: text });
      ask();
    }}
  />
</div>
```

The component fills its parent's height: give the parent one.

## Props

| Prop | Type | |
|---|---|---|
| `messages` | `ChatMessage[]` | See the message model below. Assistant `content` is Markdown. |
| `streaming` | `boolean` | Shows Stop, hides retry/edit, shows "Thinking…" on an empty last assistant message. |
| `onSend` | `(text, files: File[]) => void` | Required. Also called by starter prompts and follow-up chips. |
| `onStop` | `() => void` | Also bound to Esc. |
| `onRetry` | `(message) => void` | Omit to hide Retry (shown on the last assistant message and on errored ones). |
| `onEdit` | `(message, text) => void` | Omit to hide Edit on user messages. |
| `onAction` | `({ messageId, partId, value }) => void` | The user answered an `ask` part. |
| `onFeedback` | `(message, 'up' \| 'down' \| null) => void` | Omit to hide the thumbs. |
| `onVersion` | `(message, index) => void` | Omit to hide the `< n/m >` switcher. Use with `switchVersion`. |
| `suggestions` | `string[]` | Starter prompts on an empty conversation. |
| `toolbar` | `boolean` | Search box and Markdown/JSON export. |
| `attachments` | `boolean` | Attach button, drag & drop, paste, camera on touch devices. `accept` is passed to the file input. |
| `htmlSandbox` | `string` | `sandbox` attribute of HTML previews. Default `''` (no scripts, opaque origin). |
| `labels` | `Partial<ChatLabels>` | Every visible string, for i18n. |
| `class` | `string` | Extra class on the root. |

## Message model

```ts
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;               // Markdown for the assistant
  parts?: MessagePart[];         // rendered after content, in order
  attachments?: { name: string; size?: number; type?: string; url?: string }[];
  error?: string;
  reasoning?: string; reasoningTime?: number;          // "Thought for 4s" block
  sources?: { title: string; url: string; snippet?: string }[]; // [1] in content links to sources[0]
  followUps?: string[];
  feedback?: 'up' | 'down' | null;
  versions?: MessageVersion[]; versionIndex?: number; // managed by branch() / switchVersion()
};

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; id: string; name: string; mime: string; url?: string; blob?: Blob; size?: number;
      versions?: { label: string; url?: string; blob?: Blob }[] }
  | { type: 'tool'; id: string; name: string; args?: unknown; status: 'running' | 'done' | 'error'; result?: unknown }
  | AskPart;
```

`partError(part)` returns why a part (for example parsed from model JSON) is invalid, or `null`. `isMessagePart` is the type guard.

### Interactive parts (`ask`)

```ts
type AskPart = { type: 'ask'; id: string; title?: string; steps: AskStep[]; submitLabel?: string; answer?: unknown };
type AskStep = { id: string; prompt: string; help?: string; required?: boolean } & (
  | { kind: 'choice'; options: { value: string; label: string; icon?: string; image?: string; description?: string }[];
      multiple?: boolean; display?: 'buttons' | 'radio' | 'checkbox' | 'select'; min?: number; max?: number;
      correct?: string | string[] }                                   // value: string | string[]
  | { kind: 'text'; multiline?: boolean; placeholder?: string; pattern?: string; minLength?: number; maxLength?: number } // string
  | { kind: 'number'; min?: number; max?: number; step?: number }    // number
  | { kind: 'slider'; min: number; max: number; step?: number }      // number
  | { kind: 'rating'; max?: number }                                 // number 1..max (5)
  | { kind: 'date'; min?: string; max?: string }                     // 'YYYY-MM-DD'
  | { kind: 'file'; accept?: string; multiple?: boolean }            // File[]
  | { kind: 'confirm'; confirmLabel?: string; cancelLabel?: string } // boolean
);
```

One step is a single question; several steps make a wizard with a progress bar and Back. A single-choice step shown
as buttons answers in one click. Each step is validated (`required`, options, min/max, pattern, dates) before moving on.
On submit, `onAction({ messageId, partId, value })` receives the step's value (one step) or `{ [stepId]: value }`;
the part locks and the answer is shown as the user's reply (`formatAnswer(part, value)` gives the same text to send
to your model). Steps with `correct` are marked right or wrong (quizzes). Save `value` as `part.answer` to keep the
part locked after a reload.

### Rich blocks

Mermaid, KaTeX and Lottie are not dependencies: register a loader and they load on first use.

```ts
import { registerBlock, mermaidBlock, katexBlock, lottieBlock } from '@sergeantweb/chat-ui';
import 'katex/dist/katex.min.css';
registerBlock('mermaid', mermaidBlock(() => import('mermaid')));    // ```mermaid
registerBlock('math', katexBlock(() => import('katex')));           // ```math, $x$, $$x$$
registerBlock('lottie', lottieBlock(() => import('lottie-web')));   // ```lottie with the JSON
registerBlock('chart', (el, source) => { /* your renderer */ });
```

` ```svg ` fences and raw `<svg>` are sanitized inline (SMIL `<animate>` allowed, never on `href`). Animations pause
under `prefers-reduced-motion`.

### File previews

Built-in views by MIME/extension: image, SVG (as `<img>`, scripts never run), video, audio, PDF, HTML (sandboxed
`<iframe srcdoc>`), Markdown, CSV/TSV and JSON arrays (sortable, filterable table), text/code (highlighted), anything
else as a download card. Add your own:

```ts
import { registerPreviewer } from '@sergeantweb/chat-ui';
registerPreviewer('.glb', { load: () => import('./GlbViewer.svelte') }); // props: { file, url }
registerPreviewer('image/*', MyImageViewer);                          // exact MIME > extension > family > '*'
```

### Branching

```ts
import { branch, switchVersion } from '@sergeantweb/chat-ui';
// retry: keep the old answer as a version
messages = branch(messages, i, { id: crypto.randomUUID(), role: 'assistant', content: '' });
// <Chat onVersion={(m, k) => (messages = switchVersion(messages, messages.indexOf(m), k))} />
```

## Helpers

- `readSSE(response, signal?)`: async generator of `{ event, data, id? }` from a `fetch` response body (works with POST, unlike `EventSource`).
- `websocketStore(url)`: a readable store `{ status, last }` with `send()` and `close()`. No auto-reconnect.
- `renderMarkdown(md, { sources? })`: the sanitizer-backed renderer the component uses.
- `toMarkdown(messages)`, `toJSON(messages)`, `searchMessages(messages, q)`, `download(name, data)`.
- `sortRows`, `filterRows`, `parseCSV`: the table logic, if you need it elsewhere.

## Bundle size

Measured with Vite, minified + gzip, `Chat` mounted with no messages: **63 KB JS + 4.5 KB CSS**
(was 48 KB + 1.8 KB before parts/previews; Svelte runtime, marked and DOMPurify included). Loaded on demand:
highlight.js 52 KB (first code block), KaTeX 77 KB + fonts, Lottie 77 KB, Mermaid about 0.5 MB across chunks
(first diagram), your previewers.

## Theming

Set any of these on an ancestor (defaults: a neutral grey theme, dark via `prefers-color-scheme`, `.dark` or `[data-theme="dark"]` on `<html>`):

`--chat-bg`, `--chat-fg`, `--chat-card`, `--chat-soft`, `--chat-muted`, `--chat-line`, `--chat-primary`, `--chat-on-primary`, `--chat-bad`, `--chat-good`, `--chat-code-bg`, `--chat-code-fg`, `--chat-radius`, `--chat-font`, `--chat-mono`, `--chat-max` (column width).

```css
.my-panel { --chat-primary: #e11d48; --chat-radius: 0.5rem; --chat-max: 60rem; }
```

## Development

```sh
npm i
npm run dev     # demo at http://localhost:5181
npm test        # vitest + @testing-library/svelte
npm run check   # svelte-check
npm run build   # svelte-package + publint
```
