/**
 * dsh-egress-router — host half.
 *
 * Splits outbound traffic by purpose:
 *   - model requests (DeepSeek) stay direct,
 *   - `web_fetch` and child processes go through the configured proxy,
 *   - when the proxy is unreachable every route falls back to direct.
 *
 * The routing itself is owned by `@deepseek-ai/dsh-http-proxy`: this plugin
 * only installs a synthesized proxy-environment snapshot, which updates the
 * same process-wide policy `dsh-web-fetch-http` reads through `proxyRouteFor`,
 * and the same global undici dispatcher plain `fetch()` uses.
 *
 * Startup contract: `apply()` performs no file or network I/O and never
 * throws. All probing, registry reads, and dispatcher swaps happen on a
 * scheduled task after activation, and every failure degrades to direct.
 */
import { connect } from 'node:net';
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import z from '@deepseek-ai/schemastery';
import {
	applySystemDetection,
	normalizeProxyUrl,
	planFor,
	probeTarget,
	proxyOfEnv,
	resolveEffective
} from './policy.js';
import { readWindowsSystemProxy } from './windows-proxy.js';

/** Loader identity. */
export const name = 'dsh-egress-router';

/** No hard service dependencies; settings is wired opportunistically. */
export const inject = [];

/** Live schema of the `egress-router` entry config. */
export const Config = z
	.object({
		enabled: z.boolean().default(true).description('Master switch; off leaves the launch policy untouched.'),
		mode: z
			.union([z.const('direct'), z.const('system'), z.const('manual')])
			.default('system')
			.description('direct = no proxy; system = follow Windows/system proxy; manual = use proxy below.'),
		proxy: z.string().default('http://127.0.0.1:7897').description('HTTP(S) proxy URL used in manual mode.'),
		keepModelDirect: z.boolean().default(true).description('Always bypass the proxy for DeepSeek model hosts.'),
		noProxy: z.array(z.string()).default([]).description('Extra hosts that bypass the proxy.'),
		fallbackToDirect: z.boolean().default(true).description('When the proxy is down, route everything direct instead of failing.'),
		probeIntervalMs: z.number().default(5000).description('Health probe period; 0 disables probing.'),
		probeTimeoutMs: z.number().default(800).description('TCP connect timeout for one health probe.')
	})
	.volatile();

/** Environment variable kill switch. */
export const DISABLE_ENV = 'DSH_EGRESS_DISABLE';

/** Snapshot shape expected by `installProxyFromEnvironment`. */
function snapshotOf(values) {
	return {
		get(requested) {
			for (const candidate of [requested.toLowerCase(), requested.toUpperCase()]) {
				if (values[candidate] !== undefined) return { value: values[candidate], name: candidate };
			}
			return undefined;
		}
	};
}

/**
 * Read the launch environment's proxy variables.
 * @param {object} ctx - plugin context.
 * @returns {Record<string,string>} lowercase proxy names that were exported.
 */
function launchProxyValues(ctx) {
	const values = {};
	let env;
	try {
		env = launchEnvironmentOf(ctx);
	} catch {
		return values;
	}
	for (const key of ['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
		const hit = env.get(key) ?? env.get(key.toUpperCase());
		const value = typeof hit?.value === 'string' ? hit.value.trim() : '';
		if (value !== '') values[key] = value;
	}
	return values;
}

/**
 * TCP-connect health probe with a hard timeout.
 * @param {{host: string, port: number}} target
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probeTargetOnce(target, timeoutMs) {
	return new Promise((resolve) => {
		let settled = false;
		let socket;
		const finish = (up) => {
			if (settled) return;
			settled = true;
			try {
				socket?.destroy();
			} catch {
				/* already gone */
			}
			resolve(up);
		};
		try {
			socket = connect({ host: target.host, port: target.port });
		} catch {
			resolve(false);
			return;
		}
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => finish(true));
		socket.once('timeout', () => finish(false));
		socket.once('error', () => finish(false));
	});
}

/**
 * Build the routing engine. All state stays in this closure; nothing is
 * persisted, so a crash can never be caused by a stale file.
 * @param {object} ctx - plugin context.
 * @param {object} logger - cordis logger.
 * @param {{get: () => Record<string, unknown>}} live - live entry config.
 * @returns {{start: () => void, stop: () => Promise<void>, status: () => object}}
 */
export function createEngine(ctx, logger, live) {
	let disposed = false;
	let timer = null;
	let installed = null;
	let installedKey = null;
	let chain = Promise.resolve();
	let proxyUp = true;
	let warned = new Set();
	let status = { kind: 'idle', proxy: null, available: true };

	function log(level, message) {
		const line = `dsh-egress-router: ${message}`;
		try {
			const sink = logger?.[level];
			if (typeof sink === 'function') sink.call(logger, line);
			else if (level === 'error') console.error(line);
			else console.warn(line);
		} catch {
			/* logging must never break routing */
		}
	}

	function warnOnce(message) {
		if (warned.has(message)) return;
		if (warned.size > 50) warned = new Set();
		warned.add(message);
		log('warn', message);
	}

	function configNow() {
		try {
			return live.get() ?? {};
		} catch {
			return {};
		}
	}

	/**
	 * Resolve the settings and proxy target for this moment.
	 * Registry detection only runs on Windows and only in system mode.
	 */
	function resolveNow() {
		const config = configNow();
		let effective = resolveEffective(config, { envValues: launchProxyValues(ctx) });
		if (effective.mode === 'system' && process.platform === 'win32') {
			let detected = null;
			try {
				detected = readWindowsSystemProxy();
			} catch {
				detected = null;
			}
			if (detected) effective = applySystemDetection(detected, effective);
		}
		const target = probeTarget(effective.proxyUrl ?? proxyOfEnv(effective.envValues));
		return { config, effective, target };
	}

	/**
	 * Decide the plan for the current settings and health state.
	 * @returns {{kind: string, values: Record<string,string>, proxy?: string}}
	 */
	function planNow() {
		const { config, effective } = resolveNow();
		if (config.enabled === false) return { kind: 'disabled', values: {} };
		if (effective.mode === 'manual' && !normalizeProxyUrl(config.proxy)) {
			warnOnce(`manual mode has no usable http(s) proxy URL (got ${JSON.stringify(config.proxy)}); staying direct`);
		}
		return planFor(effective, proxyUp);
	}

	/** Drop whatever this plugin installed, restoring the launch policy. */
	async function restore() {
		const previous = installed;
		installed = null;
		installedKey = null;
		if (!previous) return;
		try {
			await previous();
		} catch (error) {
			warnOnce(`could not restore the previous proxy policy: ${String(error)}`);
		}
	}

	/** Replace whatever this plugin installed with `values`. */
	async function install(values) {
		await restore();
		const dispose = await installProxyFromEnvironment(snapshotOf(values), (message) => warnOnce(String(message)));
		installed = typeof dispose === 'function' ? dispose : null;
	}

	/** Apply the current plan, serialized through `chain`. */
	async function applyNow() {
		if (disposed) return;
		try {
			const plan = planNow();
			if (plan.kind === 'disabled') {
				await restore();
				status = { kind: 'disabled', proxy: null, available: proxyUp };
				return;
			}
			const key = JSON.stringify(plan.values, Object.keys(plan.values).sort());
			if (key === installedKey) {
				status = { ...status, kind: plan.kind, proxy: plan.proxy ?? null, available: proxyUp };
				return;
			}
			await install(plan.values);
			installedKey = key;
			status = { kind: plan.kind, proxy: plan.proxy ?? null, available: proxyUp };
			const via = plan.proxy ? ` via ${plan.proxy}` : '';
			log('info', `routing ${plan.kind}${via}${proxyUp ? '' : ' (proxy unreachable)'}`);
		} catch (error) {
			warnOnce(`routing setup failed; staying direct: ${String(error)}`);
			try {
				await install({});
				installedKey = '{}';
				status = { kind: 'fallback', proxy: null, available: false };
			} catch {
				/* direct install failed too; baseline policy remains */
			}
		}
	}

	function scheduleApply() {
		chain = chain.then(applyNow).catch(() => {});
		return chain;
	}

	/** One health sample; installs only on a state change. */
	async function tick() {
		if (disposed) return;
		const { effective, target } = resolveNow();
		if (configNow().enabled === false) {
			if (installedKey !== null) {
				await restore();
				status = { kind: 'disabled', proxy: null, available: proxyUp };
			}
			return;
		}
		if (!target) {
			if (!proxyUp) {
				proxyUp = true;
				await scheduleApply();
			}
			return;
		}
		const up = await probeTargetOnce(target, effective.probeTimeoutMs);
		if (up !== proxyUp) {
			proxyUp = up;
			log(up ? 'info' : 'warn', up ? 'proxy is reachable again; restoring proxy routing' : 'proxy is unreachable; falling back to direct');
			await scheduleApply();
		}
	}

	function scheduleNext() {
		if (disposed || timer !== null) return;
		let interval = 5000;
		try {
			interval = resolveEffective(configNow()).probeIntervalMs;
		} catch {
			interval = 5000;
		}
		if (!(interval > 0)) return;
		timer = setTimeout(() => {
			timer = null;
			tick()
				.catch(() => {})
				.finally(() => scheduleNext());
		}, interval);
		timer.unref?.();
	}

	return {
		/** Kick off routing after activation; never blocks boot. */
		start() {
			setImmediate(() => {
				if (disposed) return;
				const { target, effective } = resolveNow();
				const settle = target
					? probeTargetOnce(target, effective.probeTimeoutMs)
					: Promise.resolve(true);
				settle
					.then((up) => {
						proxyUp = up;
						return scheduleApply();
					})
					.catch(() => scheduleApply())
					.finally(() => scheduleNext());
			});
		},
		/** Restore the launch policy and stop probing. */
		async stop() {
			disposed = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			await chain.catch(() => {});
			await restore();
			status = { kind: 'stopped', proxy: null, available: proxyUp };
		},
		status() {
			return { ...status };
		}
	};
}

/**
 * Cordis entry.
 * @param {object} ctx - plugin context.
 * @param {object} config - live (volatile) config.
 */
export function apply(ctx, config) {
	if (process.env[DISABLE_ENV] === '1') {
		try {
			ctx.logger?.info?.('dsh-egress-router: disabled by DSH_EGRESS_DISABLE=1');
		} catch {
			/* ignore */
		}
		return;
	}

	const live = typeof config?.get === 'function' ? config : Config(config ?? {});
	const engine = createEngine(ctx, ctx.logger, live);

	ctx.effect(() => () => engine.stop());
	ctx.on?.('loader/volatile-update', () => void engine.start());

	// Mirror the entry config into the Settings service when one is mounted, so
	// the Web UI can edit it without touching cordis.patch.yml.
	ctx.inject?.(['settings'], (settingsCtx) => {
		try {
			settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
		} catch {
			/* settings is optional */
		}
	});

	engine.start();
}
