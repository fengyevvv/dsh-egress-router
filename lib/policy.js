/**
 * Pure routing policy for dsh-egress-router. No I/O, no imports.
 *
 * The plugin never builds its own dispatcher: it hands a synthesized proxy
 * environment snapshot to `installProxyFromEnvironment`, which updates the
 * process-wide `active` policy that `web_fetch` reads through `proxyRouteFor`.
 * This module decides *what* that snapshot should contain.
 */

/** Every mode the UI accepts. */
export const MODES = ['direct', 'system', 'manual'];

/** Hosts kept direct so model traffic never rides the proxy. */
export const MODEL_DIRECT_HOSTS = ['deepseek.com'];

/** Loopback entries merged into every proxy plan. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * Resolve the mode, tolerating an unknown value from an older config.
 * The fallback is `system`: it can only ever degrade to direct, never to a
 * stale hard-coded proxy.
 * @param {unknown} value - raw `mode`.
 * @returns {'direct'|'system'|'manual'}
 */
export function resolveMode(value) {
	return MODES.includes(value) ? value : 'system';
}

/**
 * Normalize a proxy URL to the exact string undici's ProxyAgent accepts.
 * Only http(s) proxies are supported (matching `dsh-http-proxy`).
 * @param {unknown} raw - user-provided proxy URL.
 * @returns {string|null} normalized URL, or null when unusable.
 */
export function normalizeProxyUrl(raw) {
	const text = String(raw ?? '').trim();
	if (!text) return null;
	let url;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (!url.hostname) return null;
	// A malformed port makes URL.parse throw already; keep the guard explicit.
	if (url.port !== '' && !/^\d{1,5}$/.test(url.port)) return null;
	return url.toString();
}

/**
 * Trim, drop blanks and deduplicate (case-insensitively) a bypass list.
 * @param {Array<unknown>} entries - raw entries.
 * @returns {string[]} normalized entries in first-seen order.
 */
export function mergeNoProxy(entries) {
	const out = [];
	const seen = new Set();
	for (const entry of entries ?? []) {
		const text = String(entry ?? '').trim();
		if (!text) continue;
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(text);
	}
	return out;
}

/**
 * Split a NO_PROXY string (comma and/or whitespace separated).
 * @param {unknown} value - raw value.
 * @returns {string[]}
 */
export function parseNoProxyList(value) {
	return mergeNoProxy(String(value ?? '').split(/[,\s]+/));
}

/** Clamp a numeric config value into a usable range. */
function clamp(value, min, max, fallback) {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}

/**
 * Normalize a raw entry config into the effective settings the planner reads.
 * @param {Record<string, unknown>} config - resolved entry config.
 * @param {{ envValues?: Record<string, string> }} [extra] - launch env proxies for system mode.
 * @returns {object} effective settings.
 */
export function resolveEffective(config, extra = {}) {
	const source = config ?? {};
	return {
		mode: resolveMode(source.mode),
		proxyUrl: normalizeProxyUrl(source.proxy),
		noProxy: mergeNoProxy(Array.isArray(source.noProxy) ? source.noProxy : []),
		keepModelDirect: source.keepModelDirect !== false,
		fallbackToDirect: source.fallbackToDirect !== false,
		probeIntervalMs: clamp(source.probeIntervalMs, 0, 3_600_000, 5_000),
		probeTimeoutMs: clamp(source.probeTimeoutMs, 100, 10_000, 800),
		envValues: extra.envValues ?? {}
	};
}

/**
 * Merge the bypass list: user entries, environment entries, and the model
 * hosts, then always the loopback literals.
 * @param {object} effective - resolved settings.
 * @returns {string} comma-separated NO_PROXY value.
 */
export function effectiveNoProxy(effective) {
	const merged = mergeNoProxy([
		...(effective.noProxy ?? []),
		...parseNoProxyList(effective.envValues?.no_proxy ?? effective.envValues?.NO_PROXY),
		...(effective.keepModelDirect ? MODEL_DIRECT_HOSTS : []),
		...LOOPBACK_HOSTS
	]);
	return merged.join(',');
}

/** The proxy environment keys this plugin may publish. */
export const PROXY_ENV_KEYS = [
	'http_proxy',
	'https_proxy',
	'all_proxy',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'ALL_PROXY',
	'no_proxy',
	'NO_PROXY'
];

/**
 * Decide the proxy environment snapshot to install for one health state.
 *
 * `values = {}` means "no proxy names at all", which
 * `installProxyFromEnvironment` turns into a direct policy.
 * @param {object} effective - resolved settings.
 * @param {boolean} proxyAvailable - health probe result.
 * @returns {{kind: 'direct'|'proxy'|'fallback', values: Record<string,string>, proxy?: string}}
 */
export function planFor(effective, proxyAvailable) {
	const direct = { kind: 'fallback', values: {} };
	if (effective.mode === 'direct') return { kind: 'direct', values: {} };

	const bypass = effectiveNoProxy(effective);
	const envProxy = proxyOfEnv(effective.envValues);

	// System mode with no registry proxy: reuse the launch environment's own
	// proxy variables exactly, only merging the bypass list.
	if (effective.mode === 'system' && !effective.proxyUrl && envProxy) {
		if (!proxyAvailable && effective.fallbackToDirect) return direct;
		return { kind: 'proxy', values: { ...effective.envValues, no_proxy: bypass }, proxy: envProxy };
	}

	if (!effective.proxyUrl) return direct;
	if (!proxyAvailable && effective.fallbackToDirect) return direct;
	return {
		kind: 'proxy',
		values: { http_proxy: effective.proxyUrl, https_proxy: effective.proxyUrl, no_proxy: bypass },
		proxy: effective.proxyUrl
	};
}

/**
 * Pick the representative proxy URL out of a proxy environment snapshot.
 * @param {Record<string,string>|undefined} values - environment values.
 * @returns {string|null}
 */
export function proxyOfEnv(values) {
	if (!values) return null;
	const candidate =
		values.https_proxy ?? values.HTTPS_PROXY ?? values.http_proxy ?? values.HTTP_PROXY ?? values.all_proxy ?? values.ALL_PROXY;
	return normalizeProxyUrl(candidate);
}

/**
 * Parse a proxy URL into a TCP connect target for the health probe.
 * @param {unknown} proxyUrl - normalized proxy URL.
 * @returns {{host: string, port: number}|null}
 */
export function probeTarget(proxyUrl) {
	if (!proxyUrl) return null;
	let url;
	try {
		url = new URL(String(proxyUrl));
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (!host) return null;
	const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
	if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
	return { host, port };
}

/**
 * Windows `ProxyServer` registry value -> HTTP proxy URLs.
 * Accepts `host:port` and `http=host:port;https=host:port;socks=host:port`.
 * SOCKS legs are reported separately and never used by this plugin.
 * @param {unknown} server - raw registry text.
 * @returns {{httpProxy?: string, httpsProxy?: string, socksProxy?: string}}
 */
export function parseWindowsProxyServer(server) {
	const text = String(server ?? '').trim();
	if (!text || /%[^%]+%/.test(text)) return {};

	const toUrl = (target) => {
		const value = String(target ?? '').trim();
		if (!value) return undefined;
		const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) ? value : `http://${value}`;
		const normalized = normalizeProxyUrl(withScheme);
		if (normalized === null) return undefined;
		try {
			const url = new URL(normalized);
			if (!url.port) url.port = '80';
			return url.toString();
		} catch {
			return undefined;
		}
	};

	const legs = {};
	for (const part of text.split(';')) {
		const token = part.trim();
		if (!token) continue;
		const eq = token.indexOf('=');
		if (eq === -1) continue;
		const protocol = token.slice(0, eq).trim().toLowerCase();
		const target = token.slice(eq + 1).trim();
		if (protocol && target) legs[protocol] = target;
	}

	if (Object.keys(legs).length === 0) {
		const both = toUrl(text);
		return both ? { httpProxy: both, httpsProxy: both } : {};
	}

	const http = toUrl(legs.http ?? legs.https);
	const https = toUrl(legs.https ?? legs.http);
	const socks = legs.socks ?? legs.socks5;
	const spec = {};
	if (http) spec.httpProxy = http;
	if (https) spec.httpsProxy = https;
	if (socks) spec.socksProxy = socks;
	return spec;
}

/**
 * Windows `ProxyOverride` registry value -> NO_PROXY entries.
 * `<local>` becomes the loopback set; prefix wildcards (`10.*`, `192.168.*`)
 * and CIDR blocks are dropped because the shared matcher cannot represent them.
 * @param {unknown} override - raw registry text.
 * @returns {string[]}
 */
export function parseWindowsProxyOverride(override) {
	const text = String(override ?? '');
	if (!text.trim()) return [];
	const entries = [];
	for (const part of text.split(/[;,]/)) {
		const token = part.trim();
		if (!token) continue;
		if (token === '<local>') {
			entries.push(...LOOPBACK_HOSTS);
			continue;
		}
		if (token === '*') {
			entries.push('*');
			continue;
		}
		if (/\/\d+$/.test(token)) continue; // CIDR
		if (/\*$/.test(token)) continue; // prefix wildcard
		entries.push(token.replace(/^\*\./, ''));
	}
	return mergeNoProxy(entries);
}

/**
 * Convert a detected Windows registry proxy into effective settings.
 * @param {{httpProxy?: string, httpsProxy?: string, noProxy?: string[]}} detected
 * @param {object} effective - settings to extend.
 * @returns {object} settings with proxyUrl/noProxy filled in.
 */
export function applySystemDetection(detected, effective) {
	if (!detected) return effective;
	const proxyUrl = normalizeProxyUrl(detected.httpsProxy ?? detected.httpProxy ?? '');
	return {
		...effective,
		proxyUrl,
		noProxy: mergeNoProxy([...(effective.noProxy ?? []), ...(detected.noProxy ?? [])])
	};
}
