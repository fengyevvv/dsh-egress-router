/**
 * Read the per-user Windows WinINET proxy from the registry.
 *
 * This is the same switch the Windows "System proxy" toggle (Clash Verge,
 * v2rayN, ...) writes. Read-only, bounded, and injectable for tests.
 */
import { execFileSync } from 'node:child_process';
import { parseWindowsProxyOverride, parseWindowsProxyServer } from './policy.js';

/** Registry key holding the per-user WinINET proxy. */
export const WINDOWS_PROXY_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/** Default runner: a short, hidden `reg query`. */
function defaultRun(file, args, options) {
	return execFileSync(file, args, options);
}

/**
 * Query one registry value; every failure reads as "absent".
 * @param {Function} run - `(file, args, options) => stdout`.
 * @param {string} name - value name.
 * @returns {string|undefined}
 */
function readValue(run, name) {
	try {
		const stdout = run('reg', ['query', WINDOWS_PROXY_REG_KEY, '/v', name], {
			encoding: 'utf8',
			timeout: 5000,
			windowsHide: true
		});
		const match = /REG_(?:DWORD|SZ|EXPAND_SZ)\s+(.+)$/m.exec(String(stdout ?? ''));
		return match ? match[1].trim() : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read the current WinINET proxy.
 * @param {Function} [run] - injectable runner for tests.
 * @returns {{httpProxy?: string, httpsProxy?: string, noProxy: string[]}|null}
 *   null when the system proxy is off, unreadable, or has no usable HTTP leg.
 */
export function readWindowsSystemProxy(run = defaultRun) {
	const enable = readValue(run, 'ProxyEnable');
	const enabled = enable === '0x1' || enable === '1';
	if (!enabled) return null;

	const spec = parseWindowsProxyServer(readValue(run, 'ProxyServer'));
	if (!spec.httpProxy && !spec.httpsProxy) return null;

	const noProxy = parseWindowsProxyOverride(readValue(run, 'ProxyOverride'));
	return { ...spec, noProxy };
}
