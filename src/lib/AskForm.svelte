<script lang="ts">
	// An "ask" part: one question or a multi-step wizard/quiz. Native controls for a11y; validated per step.
	import { formatAnswer, isCorrect, validateStep } from './parts.js';
	import type { AskPart, AskStep, ChatLabels } from './types.js';

	type Props = { part: AskPart; labels: ChatLabels; answer?: unknown; answered: boolean; onanswer: (value: unknown) => void };
	let { part, labels, answer, answered, onanswer }: Props = $props();

	const uid = `cu-ask-${Math.random().toString(36).slice(2, 8)}`;
	let i = $state(0);
	let values = $state<Record<string, unknown>>({});
	let error = $state<string | null>(null);
	const multi = $derived(part.steps.length > 1);
	const step = $derived(part.steps[i]);

	const init = (s: AskStep): unknown => (s.kind === 'slider' ? (s.min + s.max) / 2 : s.kind === 'choice' && s.multiple ? [] : undefined);
	const val = (s: AskStep) => (s.id in values ? values[s.id] : init(s));

	function next(s: AskStep = step, v: unknown = val(s)) {
		values[s.id] = v;
		const e = validateStep(s, v);
		error = e && labels[e];
		if (e) return;
		if (i < part.steps.length - 1) i++;
		else onanswer(multi ? $state.snapshot(values) : v);
	}
	const toggle = (s: AskStep, v: string) => {
		const cur = (val(s) as string[]) ?? [];
		values[s.id] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
	};
	const asRecord = $derived((multi ? answer : { [part.steps[0].id]: answer }) as Record<string, unknown>);
</script>

<form class="cu-ask" aria-label={part.title ?? part.steps[0].prompt} onsubmit={(e) => (e.preventDefault(), next())} novalidate>
	{#if part.title}<p class="cu-ask-title">{part.title}</p>{/if}
	{#if answered}
		<!-- Read-only summary; quiz steps are marked right or wrong. -->
		<ul class="cu-ask-done">
			{#each part.steps as s (s.id)}
				{@const ok = isCorrect(s, asRecord?.[s.id])}
				<li>
					{s.prompt}
					{#if ok != null}<strong class={ok ? 'cu-ok' : 'cu-ko'}>{ok ? labels.correct : labels.wrong}</strong>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		{#if multi}
			<div class="cu-ask-progress">
				<progress max={part.steps.length} value={i + 1} aria-label="{labels.step} {i + 1}/{part.steps.length}"></progress>
				<span>{labels.step} {i + 1}/{part.steps.length}</span>
			</div>
		{/if}
		{#key step.id}
			{@const s = step}
			{@const id = `${uid}-${s.id}`}
			<fieldset aria-describedby={error ? `${id}-err` : s.help ? `${id}-help` : undefined} class:cu-invalid={!!error}>
				<legend>{s.prompt}{#if s.required}<span aria-hidden="true"> *</span>{/if}</legend>
				{#if s.help}<p class="cu-ask-help" id="{id}-help">{s.help}</p>{/if}

				{#if s.kind === 'choice'}
					{@const display = s.display ?? (s.multiple ? 'checkbox' : 'buttons')}
					{#if display === 'buttons'}
						<div class="cu-ask-buttons">
							{#each s.options as o (o.value)}
								{@const on = s.multiple ? ((val(s) as string[]) ?? []).includes(o.value) : val(s) === o.value}
								<button type="button" class="cu-choice" aria-pressed={on} onclick={() => (s.multiple ? toggle(s, o.value) : next(s, o.value))}>
									{#if o.image}<img src={o.image} alt="" />{/if}
									{#if o.icon}<span class="cu-icon" aria-hidden="true">{o.icon}</span>{/if}
									<span>{o.label}{#if o.description}<small>{o.description}</small>{/if}</span>
								</button>
							{/each}
						</div>
					{:else if display === 'select'}
						<select aria-label={s.prompt} multiple={s.multiple} onchange={(e) => (values[s.id] = s.multiple ? [...(e.currentTarget as HTMLSelectElement).selectedOptions].map((x) => x.value) : (e.currentTarget as HTMLSelectElement).value)}>
							{#if !s.multiple}<option value="">—</option>{/if}
							{#each s.options as o (o.value)}<option value={o.value}>{o.icon ? o.icon + ' ' : ''}{o.label}</option>{/each}
						</select>
					{:else}
						{#each s.options as o (o.value)}
							<label class="cu-opt">
								{#if s.multiple || display === 'checkbox'}
									<input type="checkbox" checked={((val(s) as string[]) ?? []).includes(o.value)} onchange={() => (s.multiple ? toggle(s, o.value) : (values[s.id] = o.value))} />
								{:else}
									<input type="radio" name={id} value={o.value} checked={val(s) === o.value} onchange={() => (values[s.id] = o.value)} />
								{/if}
								{#if o.icon}<span aria-hidden="true">{o.icon}</span>{/if}
								<span>{o.label}{#if o.description}<small>{o.description}</small>{/if}</span>
							</label>
						{/each}
					{/if}
				{:else if s.kind === 'text'}
					{#if s.multiline}
						<textarea aria-label={s.prompt} placeholder={s.placeholder} maxlength={s.maxLength} rows="3" oninput={(e) => (values[s.id] = e.currentTarget.value)}>{val(s) ?? ''}</textarea>
					{:else}
						<input type="text" aria-label={s.prompt} placeholder={s.placeholder} maxlength={s.maxLength} value={val(s) ?? ''} oninput={(e) => (values[s.id] = e.currentTarget.value)} />
					{/if}
				{:else if s.kind === 'number'}
					<input type="number" aria-label={s.prompt} min={s.min} max={s.max} step={s.step} value={val(s) ?? ''} oninput={(e) => (values[s.id] = e.currentTarget.value === '' ? undefined : e.currentTarget.valueAsNumber)} />
				{:else if s.kind === 'slider'}
					<div class="cu-row">
						<input type="range" aria-label={s.prompt} min={s.min} max={s.max} step={s.step ?? 1} value={val(s)} oninput={(e) => (values[s.id] = e.currentTarget.valueAsNumber)} />
						<output>{val(s)}</output>
					</div>
				{:else if s.kind === 'rating'}
					<div class="cu-rating">
						{#each Array.from({ length: s.max ?? 5 }, (_, k) => k + 1) as n (n)}
							<label class:cu-on={(val(s) as number) >= n}>
								<input type="radio" name={id} value={n} checked={val(s) === n} onchange={() => (values[s.id] = n)} />
								<span aria-hidden="true">★</span><span class="cu-sr">{n}/{s.max ?? 5}</span>
							</label>
						{/each}
					</div>
				{:else if s.kind === 'date'}
					<input type="date" aria-label={s.prompt} min={s.min} max={s.max} value={val(s) ?? ''} oninput={(e) => (values[s.id] = e.currentTarget.value || undefined)} />
				{:else if s.kind === 'file'}
					<input type="file" aria-label={s.prompt} accept={s.accept} multiple={s.multiple} onchange={(e) => (values[s.id] = [...(e.currentTarget.files ?? [])])} />
				{:else if s.kind === 'confirm'}
					<div class="cu-ask-buttons">
						<button type="button" class="cu-choice" onclick={() => next(s, true)}>{s.confirmLabel ?? labels.yes}</button>
						<button type="button" class="cu-choice" onclick={() => next(s, false)}>{s.cancelLabel ?? labels.no}</button>
					</div>
				{/if}
				{#if error}<p class="cu-error" id="{id}-err" role="alert">{error}</p>{/if}
			</fieldset>
			<div class="cu-row">
				{#if multi && i > 0}<button type="button" class="cu-btn" onclick={() => ((i -= 1), (error = null))}>{labels.back}</button>{/if}
				{#if s.kind !== 'confirm' && !(s.kind === 'choice' && (s.display ?? 'buttons') === 'buttons' && !s.multiple)}
					<button type="submit" class="cu-btn cu-primary">{i < part.steps.length - 1 ? labels.next : (part.submitLabel ?? labels.submit)}</button>
				{/if}
			</div>
		{/key}
	{/if}
</form>
{#if answered}
	<div class="cu-reply" role="note"><p class="cu-text">{formatAnswer(part, answer, labels)}</p></div>
{/if}
