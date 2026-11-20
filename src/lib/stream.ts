// Transport helpers. The Chat component never talks to a server: these turn a stream into text you append to a message.
import { writable, type Readable } from 'svelte/store';

export type SSEEvent = { event: string; data: string; id?: string };

/** Parses a Server-Sent Events body (from fetch, so POST and headers work, unlike EventSource). Stops on abort. */
export async function* readSSE(res: Response, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
	if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status} ${res.statusText}`);
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buf = '';
	let ev: SSEEvent = { event: 'message', data: '' };
	let hasData = false;
	try {
		while (!signal?.aborted) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += value;
			const lines = buf.split(/\r\n|\r|\n/);
			buf = lines.pop() ?? '';
			for (const line of lines) {
				if (line === '') {
					if (hasData) yield ev;
					ev = { event: 'message', data: '' };
					hasData = false;
					continue;
				}
				if (line.startsWith(':')) continue;
				const i = line.indexOf(':');
				const field = i < 0 ? line : line.slice(0, i);
				const val = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
				if (field === 'data') {
					ev.data = hasData ? ev.data + '\n' + val : val;
					hasData = true;
				} else if (field === 'event') ev.event = val;
				else if (field === 'id') ev.id = val;
			}
		}
		if (hasData && !signal?.aborted) yield ev;
	} finally {
		reader.cancel().catch(() => {});
	}
}

export type SocketState = { status: 'connecting' | 'open' | 'closed'; last: string | null };

/** A WebSocket as a Svelte store: `$socket.status`, `$socket.last` (latest text message), plus send() and close().
 *  ponytail: no auto-reconnect; wrap it if the server drops connections often. */
export function websocketStore(url: string, protocols?: string | string[]): Readable<SocketState> & { send: (data: string) => void; close: () => void; socket: WebSocket } {
	const state = writable<SocketState>({ status: 'connecting', last: null });
	const socket = new WebSocket(url, protocols);
	socket.addEventListener('open', () => state.update((s) => ({ ...s, status: 'open' })));
	socket.addEventListener('close', () => state.update((s) => ({ ...s, status: 'closed' })));
	socket.addEventListener('message', (e) => typeof e.data === 'string' && state.update((s) => ({ ...s, last: e.data })));
	return { subscribe: state.subscribe, send: (d) => socket.send(d), close: () => socket.close(), socket };
}
