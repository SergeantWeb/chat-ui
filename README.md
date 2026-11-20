# @sergeantweb/chat-ui

A ChatGPT-like chat UI for **Svelte 5**. One component, three small dependencies, no CSS framework.

- Streaming Markdown (GFM tables, quotes, lists), sanitized with DOMPurify
- Code blocks with syntax highlighting (highlight.js, loaded lazily on the first code block) and a Copy button
- Message actions: copy, retry/regenerate, edit and resubmit
- Stop button while streaming
- Auto-growing composer: Enter sends, Shift+Enter adds a line (IME-safe)
- Attachments (file picker, removable chips)
- Follows the stream, stops following when you scroll up, scroll-to-bottom button
- Accessible: `role="log"` live region, labelled controls, visible focus, reduced motion
- Themed with CSS variables, light and dark
- Transport-agnostic: you own the messages array; helpers for SSE (`readSSE`) and WebSocket (`websocketStore`)

MIT licensed.

## Install

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
| `messages` | `ChatMessage[]` | `{ id, role: 'user' \| 'assistant' \| 'system', content, attachments?, error? }`. Assistant content is Markdown. |
| `streaming` | `boolean` | Shows Stop, hides retry/edit, shows "Thinking…" on an empty last assistant message. |
| `onSend` | `(text, files: File[]) => void` | Required. |
| `onStop` | `() => void` | |
| `onRetry` | `(message) => void` | Omit to hide Retry (shown on the last assistant message and on errored ones). |
| `onEdit` | `(message, text) => void` | Omit to hide Edit on user messages. |
| `attachments` | `boolean` | Shows the attach button. `accept` is passed to the file input. |
| `labels` | `Partial<ChatLabels>` | Every visible string, for i18n. |
| `class` | `string` | Extra class on the root. |

## Transport helpers

- `readSSE(response, signal?)`: async generator of `{ event, data, id? }` from a `fetch` response body (works with POST, unlike `EventSource`).
- `websocketStore(url)`: a readable store `{ status, last }` with `send()` and `close()`. No auto-reconnect.
- `renderMarkdown(md)`: the sanitizer-backed renderer the component uses, if you need it elsewhere.

## Theming

Set any of these on an ancestor (defaults: a neutral grey theme, dark via `prefers-color-scheme`, `.dark` or `[data-theme="dark"]` on `<html>`):

`--chat-bg`, `--chat-fg`, `--chat-card`, `--chat-soft`, `--chat-muted`, `--chat-line`, `--chat-primary`, `--chat-on-primary`, `--chat-bad`, `--chat-code-bg`, `--chat-code-fg`, `--chat-radius`, `--chat-font`, `--chat-mono`, `--chat-max` (column width).

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
