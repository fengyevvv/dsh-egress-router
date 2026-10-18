import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applySystemDetection,
	effectiveNoProxy,
	mergeNoProxy,
	normalizeProxyUrl,
	parseWindowsProxyOverride,
	parseWindowsProxyServer,
	planFor,
	probeTarget,
	proxyOfEnv,
	resolveEffective,
	resolveMode
} from '../lib/policy.js';
import { readWindowsSystemProxy } from '../lib/windows-proxy.js';

test('normalizeProxyUrl accepts only http(s) with a host', () => {
	assert.equal(normalizeProxyUrl('http://127.0.0.1:7897'), 'http://127.0.0.1:7897/');
	assert.equal(normalizeProxyUrl('  https://proxy.local:8443  '), 'https://proxy.local:8443/');
	assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), null);
	assert.equal(normalizeProxyUrl('not a url'), null);
	assert.equal(normalizeProxyUrl(''), null);
	assert.equal(normalizeProxyUrl(undefined), null);
});

test('resolveMode falls back to system and keeps known modes', () => {
	assert.equal(resolveMode('direct'), 'direct');
	assert.equal(resolveMode('system'), 'system');
	assert.equal(resolveMode('manual'), 'manual');
	assert.equal(resolveMode('nonsense'), 'system');
	assert.equal(resolveMode(undefined), 'system');
});

test('mergeNoProxy trims, drops blanks, dedupes case-insensitively', () => {
	assert.deepEqual(mergeNoProxy([' a.com ', 'A.COM', '', null, 'b.com']), ['a.com', 'b.com']);
});

test('resolveEffective applies defaults and clamps probe settings', () => {
	const effective = resolveEffective({ mode: 'manual', proxy: 'http://127.0.0.1:7897' });
	assert.equal(effective.proxyUrl, 'http://127.0.0.1:7897/');
	assert.equal(effective.keepModelDirect, true);
	assert.equal(effective.fallbackToDirect, true);
	assert.equal(effective.probeIntervalMs, 5000);
	assert.equal(effective.probeTimeoutMs, 800);
	assert.equal(resolveEffective({ probeIntervalMs: -5 }).probeIntervalMs, 0);
	assert.equal(resolveEffective({ probeTimeoutMs: 1 }).probeTimeoutMs, 100);
	assert.equal(resolveEffective({ probeIntervalMs: 10 ** 9 }).probeIntervalMs, 3_600_000);
});

test('effectiveNoProxy always carries model hosts and loopback', () => {
	const bypass = effectiveNoProxy(resolveEffective({ noProxy: ['internal.example'] }));
	assert.ok(bypass.split(',').includes('internal.example'));
	assert.ok(bypass.split(',').includes('deepseek.com'));
	assert.ok(bypass.split(',').includes('localhost'));
	assert.ok(bypass.split(',').includes('127.0.0.1'));
	assert.ok(bypass.split(',').includes('::1'));
	const noModel = effectiveNoProxy(resolveEffective({ keepModelDirect: false }));
	assert.ok(!noModel.split(',').includes('deepseek.com'));
});

test('planFor: direct mode publishes no proxy names', () => {
	assert.deepEqual(planFor(resolveEffective({ mode: 'direct' }), true), { kind: 'direct', values: {} });
});

test('planFor: manual mode proxies with bypass and model direct', () => {
	const plan = planFor(resolveEffective({ mode: 'manual', proxy: 'http://127.0.0.1:7897' }), true);
	assert.equal(plan.kind, 'proxy');
	assert.equal(plan.values.http_proxy, 'http://127.0.0.1:7897/');
	assert.equal(plan.values.https_proxy, 'http://127.0.0.1:7897/');
	assert.match(plan.values.no_proxy, /deepseek\.com/);
	assert.match(plan.values.no_proxy, /localhost/);
});

test('planFor: unreachable proxy falls back to direct by default', () => {
	assert.deepEqual(planFor(resolveEffective({ mode: 'manual', proxy: 'http://127.0.0.1:7897' }), false), {
		kind: 'fallback',
		values: {}
	});
});

test('planFor: fallbackToDirect=false keeps the proxy plan', () => {
	const plan = planFor(
		resolveEffective({ mode: 'manual', proxy: 'http://127.0.0.1:7897', fallbackToDirect: false }),
		false
	);
	assert.equal(plan.kind, 'proxy');
	assert.equal(plan.values.https_proxy, 'http://127.0.0.1:7897/');
});

test('planFor: manual mode without a usable URL stays direct', () => {
	assert.deepEqual(planFor(resolveEffective({ mode: 'manual', proxy: 'socks5://127.0.0.1:1080' }), true), {
		kind: 'fallback',
		values: {}
	});
});

test('planFor: system mode reuses launch proxy variables', () => {
	const effective = resolveEffective(
		{ mode: 'system', keepModelDirect: true },
		{ envValues: { https_proxy: 'http://127.0.0.1:7897', no_proxy: 'corp.example' } }
	);
	const plan = planFor(effective, true);
	assert.equal(plan.kind, 'proxy');
	assert.equal(plan.values.https_proxy, 'http://127.0.0.1:7897');
	assert.match(plan.values.no_proxy, /corp\.example/);
	assert.match(plan.values.no_proxy, /deepseek\.com/);
	assert.deepEqual(planFor(effective, false), { kind: 'fallback', values: {} });
});

test('proxyOfEnv prefers https, then http, then all', () => {
	assert.equal(proxyOfEnv({ all_proxy: 'http://a:1', http_proxy: 'http://b:2' }), 'http://b:2/');
	assert.equal(proxyOfEnv({ all_proxy: 'http://a:1' }), 'http://a:1/');
	assert.equal(proxyOfEnv({}), null);
});

test('probeTarget derives host and default port', () => {
	assert.deepEqual(probeTarget('http://127.0.0.1:7897/'), { host: '127.0.0.1', port: 7897 });
	assert.deepEqual(probeTarget('https://proxy.local'), { host: 'proxy.local', port: 443 });
	assert.deepEqual(probeTarget('http://proxy.local'), { host: 'proxy.local', port: 80 });
	assert.deepEqual(probeTarget('http://[::1]:7897/'), { host: '::1', port: 7897 });
	assert.equal(probeTarget(''), null);
});

test('parseWindowsProxyServer handles both registry shapes', () => {
	assert.deepEqual(parseWindowsProxyServer('127.0.0.1:7897'), {
		httpProxy: 'http://127.0.0.1:7897/',
		httpsProxy: 'http://127.0.0.1:7897/'
	});
	assert.deepEqual(parseWindowsProxyServer('http=127.0.0.1:7897;https=127.0.0.1:7898'), {
		httpProxy: 'http://127.0.0.1:7897/',
		httpsProxy: 'http://127.0.0.1:7898/'
	});
	assert.deepEqual(parseWindowsProxyServer('socks=127.0.0.1:1080'), {
		socksProxy: '127.0.0.1:1080'
	});
	assert.deepEqual(parseWindowsProxyServer('%PROXY%'), {});
	assert.deepEqual(parseWindowsProxyServer(''), {});
});

test('parseWindowsProxyOverride expands <local> and drops unrepresentable rules', () => {
	assert.deepEqual(parseWindowsProxyOverride('<local>;*.example.com;10.*;192.168.0.0/16;direct.test'), [
		'localhost',
		'127.0.0.1',
		'::1',
		'example.com',
		'direct.test'
	]);
	assert.deepEqual(parseWindowsProxyOverride(''), []);
});

const REGISTRY = {
	ProxyEnable: ['REG_DWORD', '0x1'],
	ProxyServer: ['REG_SZ', '127.0.0.1:7897'],
	ProxyOverride: ['REG_SZ', '<local>;*.corp.test']
};

function fakeRun(overrides = {}) {
	const table = { ...REGISTRY, ...overrides };
	return (file, args) => {
		assert.equal(file, 'reg');
		const name = args.at(-1);
		const entry = table[name];
		if (!entry) throw new Error('missing value');
		return `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n    ${name}    ${entry[0]}    ${entry[1]}\r\n\r\n`;
	};
}

test('readWindowsSystemProxy reads only an enabled, usable proxy', () => {
	assert.deepEqual(readWindowsSystemProxy(fakeRun()), {
		httpProxy: 'http://127.0.0.1:7897/',
		httpsProxy: 'http://127.0.0.1:7897/',
		noProxy: ['localhost', '127.0.0.1', '::1', 'corp.test']
	});
	assert.equal(readWindowsSystemProxy(fakeRun({ ProxyEnable: ['REG_DWORD', '0x0'] })), null);
	assert.equal(readWindowsSystemProxy(fakeRun({ ProxyServer: ['REG_SZ', 'socks=127.0.0.1:1080'] })), null);
	assert.equal(readWindowsSystemProxy(() => { throw new Error('reg missing'); }), null);
});

test('applySystemDetection fills proxy and bypass without losing user rules', () => {
	const effective = resolveEffective({ mode: 'system', noProxy: ['user.test'] });
	const merged = applySystemDetection(
		{ httpsProxy: 'http://127.0.0.1:7897/', noProxy: ['corp.test'] },
		effective
	);
	assert.equal(merged.proxyUrl, 'http://127.0.0.1:7897/');
	assert.deepEqual(merged.noProxy, ['user.test', 'corp.test']);
});
