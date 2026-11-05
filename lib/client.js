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
				description: '模型请求（DeepSeek）直连；其余流量走代理；代理不可用时只让应急名单直连，名单外请求保持失败。保存立即生效。',
				direct: '全部直连',
				system: '跟随系统',
				manual: '手动代理',
				proxy: '代理地址',
				placeholder: 'http://127.0.0.1:7897',
				keepModelDirect: '模型请求直连（deepseek.com 绕过代理）',
				proxyHint: '支持 http:// 与 https:// 代理；回环地址始终直连。',
				emergencyTitle: '应急直连',
				emergencyBadge: '仅代理不可用时生效',
				emergencyHint: '代理正常时这些域名仍走代理；代理不可用时才直连。名单之外的请求保持失败，不会回落到直连。',
				emergencyPlaceholder: '输入域名或 IP，例如 baidu.com',
				add: '添加',
				remove: '删除',
				emergencyEmpty: '尚未添加。',
				emergencyInvalid: '请输入域名或 IP（不要带 http:// 或路径）',
				emergencyNote: '支持域名与具体 IP；不支持 192.168.* 这类网段。',
				invalid: '请输入有效的 http(s) 代理地址',
				failed: '保存失败，请重试',
				readOnly: '当前设置只读',
				saved: '已保存'
			},
			en: {
				title: 'Egress routing',
				description:
					'Model requests (DeepSeek) go direct; everything else uses the proxy. When the proxy is down, only the emergency list goes direct; everything else fails closed. Saves apply immediately.',
				direct: 'Direct only',
				system: 'Follow system',
				manual: 'Manual proxy',
				proxy: 'Proxy URL',
				placeholder: 'http://127.0.0.1:7897',
				keepModelDirect: 'Keep model requests direct (bypass deepseek.com)',
				proxyHint: 'http:// and https:// proxies are supported; loopback always stays direct.',
				emergencyTitle: 'Emergency direct',
				emergencyBadge: 'Only while the proxy is unavailable',
				emergencyHint:
					'While the proxy works, these hosts still use it. Only when the proxy is unavailable do they go direct; every other request fails closed instead of falling back.',
				emergencyPlaceholder: 'Hostname or IP, e.g. baidu.com',
				add: 'Add',
				remove: 'Remove',
				emergencyEmpty: 'No hosts yet.',
				emergencyInvalid: 'Enter a hostname or IP (no http:// or path)',
				emergencyNote: 'Hostnames and exact IPs only; 192.168.* ranges are not supported.',
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
			.dshEgressSection{display:flex;flex-direction:column;gap:8px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px}
			.dshEgressSectionHead{display:flex;align-items:center;gap:8px}
			.dshEgressSectionTitle{font-size:13px;font-weight:500;line-height:20px}
			.dshEgressBadge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
			.dshEgressAddRow{display:flex;gap:8px}
			.dshEgressAddRow input{box-sizing:border-box;flex:1;min-width:0;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-input);color:var(--dsw-alias-label-primary);font:inherit}
			.dshEgressAddBtn{flex:none;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
			.dshEgressAddBtn:disabled{opacity:.5;cursor:default}
			.dshEgressList{display:flex;flex-direction:column;gap:6px}
			.dshEgressItem{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-input);font-size:13px}
			.dshEgressRemove{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:16px;line-height:22px;cursor:pointer}
			.dshEgressRemove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
			.dshEgressRemove:disabled{opacity:.5;cursor:default}
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
			return ['direct', 'system', 'manual'].includes(value?.mode) ? value.mode : 'system';
		}

		function proxyValid(value) {
			try {
				const url = new URL(String(value ?? '').trim());
				return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
			} catch {
				return false;
			}
		}

		function normalizeHost(value) {
			let host = String(value ?? '').trim();
			if (!host) return '';
			host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
			host = host.replace(/^\[|\]$/g, '');
			if (!host || host === '*' || /\s/.test(host)) return '';
			return host;
		}

		function Row({ scope, t }) {
			const snapshot = React.useSyncExternalStore(
				React.useCallback((listener) => scope.subscribe(listener), [scope]),
				React.useCallback(() => scope.getSnapshot(), [scope]),
				React.useCallback(() => scope.getSnapshot(), [scope])
			);
			const [draft, setDraft] = React.useState({
				mode: 'system',
				proxy: '',
				keepModelDirect: true,
				emergencyDirectHosts: []
			});
			const [hostInput, setHostInput] = React.useState('');
			const [hostError, setHostError] = React.useState('');
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
					keepModelDirect: value.keepModelDirect !== false,
					emergencyDirectHosts: Array.isArray(value.emergencyDirectHosts) ? value.emergencyDirectHosts.map(String) : []
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
						keepModelDirect: current.value?.keepModelDirect !== false,
						emergencyDirectHosts: Array.isArray(current.value?.emergencyDirectHosts)
							? current.value.emergencyDirectHosts.map(String)
							: []
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

			const addHost = () => {
				if (saving || disabled) return;
				const host = normalizeHost(hostInput);
				if (!host) {
					setHostError(t('emergencyInvalid'));
					return;
				}
				const list = draft.emergencyDirectHosts ?? [];
				if (list.some((item) => item.toLowerCase() === host.toLowerCase())) {
					setHostInput('');
					setHostError('');
					return;
				}
				setHostError('');
				setHostInput('');
				void persist({ emergencyDirectHosts: [...list, host] }, snapshot.revision);
			};

			const removeHost = (host) => {
				if (saving || disabled) return;
				const list = (draft.emergencyDirectHosts ?? []).filter((item) => item !== host);
				void persist({ emergencyDirectHosts: list }, snapshot.revision);
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
					{ className: 'dshEgressSection' },
					h(
						'div',
						{ className: 'dshEgressSectionHead' },
						h('div', { className: 'dshEgressSectionTitle' }, t('emergencyTitle')),
						h('span', { className: 'dshEgressBadge' }, t('emergencyBadge'))
					),
					h('div', { className: 'dshEgressHint' }, t('emergencyHint')),
					h(
						'div',
						{ className: 'dshEgressAddRow' },
						h('input', {
							type: 'text',
							value: hostInput,
							placeholder: t('emergencyPlaceholder'),
							spellCheck: false,
							disabled,
							onChange: (event) => {
								setHostInput(event.target.value);
								setHostError('');
							},
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									addHost();
								}
							}
						}),
						h(
							'button',
							{
								type: 'button',
								className: 'dshEgressAddBtn',
								disabled: disabled || !hostInput.trim(),
								onClick: addHost
							},
							t('add')
						)
					),
					hostError && h('div', { className: 'dshEgressError', role: 'alert' }, hostError),
					(draft.emergencyDirectHosts?.length ?? 0) > 0
						? h(
								'div',
								{ className: 'dshEgressList' },
								draft.emergencyDirectHosts.map((host) =>
									h(
										'div',
										{ className: 'dshEgressItem', key: host },
										h('span', null, host),
										h(
											'button',
											{
												type: 'button',
												className: 'dshEgressRemove',
												'aria-label': `${t('remove')} ${host}`,
												disabled,
												onClick: () => removeHost(host)
											},
											'×'
										)
									)
								)
							)
						: h('div', { className: 'dshEgressHint' }, t('emergencyEmpty')),
					h('div', { className: 'dshEgressHint' }, t('emergencyNote'))
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
