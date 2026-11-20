export type Attachment = { name: string; size?: number; type?: string; url?: string };

export type ChatMessage = {
	id: string;
	role: 'user' | 'assistant' | 'system';
	/** Markdown for assistant messages, plain text for user messages. */
	content: string;
	attachments?: Attachment[];
	/** Shown under the message, with a retry button on assistant messages. */
	error?: string;
};

export type ChatLabels = {
	placeholder: string;
	send: string;
	stop: string;
	copy: string;
	copied: string;
	retry: string;
	edit: string;
	save: string;
	cancel: string;
	attach: string;
	remove: string;
	scrollDown: string;
	thinking: string;
	conversation: string;
};

export const defaultLabels: ChatLabels = {
	placeholder: 'Send a message',
	send: 'Send',
	stop: 'Stop',
	copy: 'Copy',
	copied: 'Copied',
	retry: 'Retry',
	edit: 'Edit',
	save: 'Save & submit',
	cancel: 'Cancel',
	attach: 'Attach files',
	remove: 'Remove',
	scrollDown: 'Scroll to bottom',
	thinking: 'Thinking…',
	conversation: 'Conversation'
};
