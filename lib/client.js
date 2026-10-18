// Browser companion for dsh-egress-router. The Host settings form (backed by
// the profile's cordis.patch.yml) is the single source of truth: the UI writes
// it, the Host watches the entry and re-routes immediately.
window.__ModuleLoader__.load({
	id: 'dsh-egress-router',
	factory: (require) => {
		const module = { exports: {} };
		const React = require('react');
		const h = React.createElement;
		const NS = 'egress-router';

		const COPY = {
			zh: {
				title: '出站分流',
				description: '模型请求（DeepSeek）直连；网页抓取走代理；代理不可用时自动回落直连。保存立即生效。',
				direct: '全部直连',
				system: '跟随系统',
				manual: '手动代理',
				proxy: '代理地址',
				placeholder: 'http://127.0.0.1:7897',
				keepModelDirect: '模型请求直连（deepseek.com 绕过代理）',
				proxyHint: '支持 http:// 与 https:// 代理；回环地址始终直连。',
				invalid: '请输入有效的 http(s) 代理地址',
				failed: '保存失败，请重试',
				readOnly: '当前设置只读',
				saved: '已保存'
			},
			en: {
				title: 'Egress routing',
				description:
					'Model requests (DeepSeek) go direct; web fetches use the proxy; when the proxy is down everything falls back to direct. Saves apply immediately.',
				direct: 'Direct only',
				system: 'Follow system',
				manual: 'Manual proxy',
				proxy: 'Proxy URL',
				placeholder: 'http://127.0.0.1:7897',
				keepModelDirect: 'Keep model requests direct (bypass deepseek.com)',
				proxyHint: 'http:// and https:// proxies are supported; loopback always stays direct.',
				invalid: 'Enter a valid http(s) proxy URL',
				failed: 'Save failed, please retry',
				readOnly: 'Settings are read-only',
				saved: 'Saved'
			}
		};

		const CSS = `
			.dshEgressRow{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px}
			.dshEgressHead{display:flex;align-items:center;gap:8px}
			.dshEgressText{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px;padding-right:48px}
			.dshEgressTitle{font-size:14px;font-weight:400;line-height:22px}
			.dshEgressHint{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
			.dshEgressSelect{height:36px;padding:0 12px;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
			.dshEgressSelect:disabled{opacity:.6;cursor:default}
			.dshEgressForm{display:flex;flex-direction:column;gap:10px}
			.dshEgressField{display:flex;flex-direction:column;gap:5px}
			.dshEgressField input{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-input);color:var(--dsw-alias-label-primary);font:inherit}
			.dshEgressCheck{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--dsw-alias-label-primary)}
			.dshEgressStatus{min-height:16px}
			.dshEgressError{color:var(--dsw-alias-label-error);font-size:12px}
			.dshEgressSaved{color:var(--dsw-alias-label-tertiary);font-size:12px}
			.dshEgressRow :focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
		`;

		function ensureStyles() {
			if (document.querySelector('style[data-plugin-css="dsh-egress-router"]')) return;
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-egress-router';
			tag.dataset.pluginCss = 'dsh-egress-router';
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function modeOf(value) {
			return ['direct', 'system', 'manual'].includes(value?.mode) ? value.mode : 'manual';
		}

		function proxyValid(value) {
			try {
				const url = new URL(String(value ?? '').trim());
				return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
			} catch {
				return false;
			}
		}

		function Row({ scope, t }) {
			const snapshot = React.useSyncExternalStore(
				React.useCallback((listener) => scope.subscribe(listener), [scope]),
				React.useCallback(() => scope.getSnapshot(), [scope]),
				React.useCallback(() => scope.getSnapshot(), [scope])
			);
			const [draft, setDraft] = React.useState({ mode: 'manual', proxy: '', keepModelDirect: true });
			const [dirty, setDirty] = React.useState(false);
			const [saving, setSaving] = React.useState(false);
			const [error, setError] = React.useState('');
			const [saved, setSaved] = React.useState(false);
			const alive = React.useRef(true);

			React.useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);

			React.useEffect(() => {
				if (dirty || snapshot.status !== 'ready') return;
				const value = snapshot.value ?? {};
				const next = {
					mode: modeOf(value),
					proxy: String(value.proxy ?? ''),
					keepModelDirect: value.keepModelDirect !== false
				};
				setDraft((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
			}, [snapshot, dirty]);

			if (snapshot.status !== 'ready') return null;

			const disabled = snapshot.writable === false || saving;

			const persist = async (fields, expectedRevision) => {
				setSaving(true);
				setError('');
				setSaved(false);
				try {
					await scope.mutate(
						Object.entries(fields).map(([key, value]) => ({ op: 'set', path: [key], value })),
						expectedRevision
					);
					if (!alive.current) return;
					const current = scope.getSnapshot();
					setDraft({
						mode: modeOf(current.value ?? {}),
						proxy: String(current.value?.proxy ?? ''),
						keepModelDirect: current.value?.keepModelDirect !== false
					});
					setDirty(false);
					setSaved(true);
				} catch {
					if (alive.current) setError(t('failed'));
				} finally {
					if (alive.current) setSaving(false);
				}
			};

			const changeMode = (mode) => {
				if (mode === draft.mode || saving) return;
				setDraft((before) => ({ ...before, mode }));
				setDirty(false);
				setError('');
				if (mode === 'manual' && !proxyValid(draft.proxy)) {
					setDirty(true);
					return;
				}
				void persist({ mode }, snapshot.revision);
			};

			const commitProxy = () => {
				if (saving || draft.mode !== 'manual' || !proxyValid(draft.proxy)) return;
				if (!dirty) return;
				void persist({ proxy: draft.proxy.trim(), mode: 'manual' }, snapshot.revision);
			};

			const invalid = draft.mode === 'manual' && dirty && !proxyValid(draft.proxy);

			return h(
				'div',
				{ className: 'dshEgressRow' },
				h(
					'div',
					{ className: 'dshEgressHead' },
					h(
						'div',
						{ className: 'dshEgressText' },
						h('div', { className: 'dshEgressTitle' }, t('title')),
						h('div', { className: 'dshEgressHint' }, t('description'))
					),
					h(
						'select',
						{
							className: 'dshEgressSelect',
							'aria-label': t('title'),
							value: draft.mode,
							disabled,
							onChange: (event) => changeMode(event.target.value)
						},
						h('option', { value: 'direct' }, t('direct')),
						h('option', { value: 'system' }, t('system')),
						h('option', { value: 'manual' }, t('manual'))
					)
				),
				draft.mode === 'manual' &&
					h(
						'div',
						{ className: 'dshEgressForm' },
						h(
							'label',
							{ className: 'dshEgressField' },
							t('proxy'),
							h('input', {
								type: 'text',
								value: draft.proxy,
								placeholder: t('placeholder'),
								spellCheck: false,
								disabled,
								onChange: (event) => {
									const proxy = event.target.value;
									setDraft((before) => ({ ...before, proxy }));
									setDirty(true);
									setSaved(false);
									setError('');
								},
								onBlur: commitProxy,
								onKeyDown: (event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										event.currentTarget.blur();
									}
								}
							})
						),
						h(
							'label',
							{ className: 'dshEgressCheck' },
							h('input', {
								type: 'checkbox',
								checked: draft.keepModelDirect,
								disabled,
								onChange: (event) => {
									const keepModelDirect = event.target.checked;
									setDraft((before) => ({ ...before, keepModelDirect }));
									void persist({ keepModelDirect }, snapshot.revision);
								}
							}),
							t('keepModelDirect')
						),
						h('div', { className: 'dshEgressHint' }, t('proxyHint'))
					),
				h(
					'div',
					{ className: 'dshEgressStatus', 'aria-live': 'polite' },
					snapshot.writable === false && h('span', { className: 'dshEgressHint' }, t('readOnly')),
					invalid && h('span', { className: 'dshEgressError', role: 'alert' }, t('invalid')),
					error && h('span', { className: 'dshEgressError', role: 'alert' }, error),
					!invalid && !error && saved && h('span', { className: 'dshEgressSaved' }, t('saved'))
				)
			);
		}

		const inject = ['slots', 'locale', 'configForms'];

		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register('settings.egress', COPY), 'dsh-egress-router: translations');
			const t = ctx.locale.bind('settings.egress');
			let scope;
			try {
				scope = ctx.configForms.get(NS);
			} catch {
				return;
			}
			if (!scope) return;
			ctx.slots.inject('settings.general.item', () =>
				ctx.slots.register(
					{
						name: 'settings.general.item',
						id: NS,
						order: 25,
						locale: 'settings.egress',
						inject: () => ({ scope, t })
					},
					Row
				)
			);
		}

		module.exports = { apply, inject };
		return module.exports;
	}
});
