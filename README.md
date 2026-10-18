# dsh-egress-router

给 **DeepSeek Harness（DSH）** 用的出站分流插件：

- **模型请求（DeepSeek）直连**，不经过代理；
- **`web_fetch` / 子进程走代理**（Clash、V2Ray 等）；
- **代理挂了自动回落直连**，恢复后自动切回；
- 在 **设置 → 通用 → 出站分流** 里切换：全部直连 / 跟随系统 / 手动代理。

不依赖 `.env`，不写任何状态文件，启动路径零 I/O，任何异常都降级为直连。

> 当前版本：`0.1.1` · 平台：Windows（`system` 模式读 Windows 注册表）· 适配 DSH `0.2.1-rc.2`

---

## 它解决什么问题

DSH 原生只在启动时读一次代理环境变量，之后没有运行时开关：

- 模型请求和网页抓取走同一条路，没法按用途分开；
- 代理关掉后 `web_fetch` 直接失败，不会自动回落；
- 切换代理要改 `~/.dsh/.env` 并重启。

这个插件把策略装进 `@deepseek-ai/dsh-http-proxy` 的进程级 `active` 策略：

- `dsh-web-fetch-http` 每次请求都会调用 `proxyRouteFor(url)`，所以换策略立刻改变 `web_fetch` 的走向；
- 普通 `fetch()` 读全局 undici dispatcher，也一起改变；
- 子进程通过导出的 `HTTP(S)_PROXY` / `NO_PROXY` 跟随；
- `deepseek.com` 始终在 `NO_PROXY` 里。

## 三种模式

| 模式 | 行为 |
|---|---|
| `direct` | 不装任何代理，全部直连 |
| `system` | 读 Windows 注册表 `HKCU\...\Internet Settings` 的 `ProxyEnable` / `ProxyServer` / `ProxyOverride`（也就是 Clash 的「系统代理」开关） |
| `manual` | 用配置里的 `proxy` 地址 |

健康检查：每 `probeIntervalMs` 毫秒对代理做一次 TCP 连接探测；失败且 `fallbackToDirect: true` 时切到直连，恢复后自动切回。

## 兼容性

| 项 | 要求 |
|---|---|
| DSH | `0.2.1-rc.2`（同版本实测） |
| 平台 | Windows 10/11（`system` 模式依赖注册表） |
| Node | DSH 自带运行时即可（Node 22+） |
| 代理 | HTTP(S) 代理；Clash 的「混合端口」用 `http://127.0.0.1:7897` 即可 |

非 Windows 上 `system` 模式只读启动环境变量，不会读系统代理设置。

## 安装

### 方式 A：手动安装（已实测，推荐）

1. 从 [Releases](../../releases) 下载 `dsh-egress-router-0.1.1.zip`，解压；或直接 clone 本仓库。
2. 把 `lib/` 和 `package.json` 复制到 profile 的 `node_modules` 下：

```powershell
$src = ".\dsh-egress-router"                # clone 出来的目录；Release 解压后按实际文件夹名改
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-egress-router"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\lib" $dst -Recurse -Force
Copy-Item "$src\package.json" $dst -Force
```

3. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: egress-router
      name: dsh-egress-router
      config:
        mode: system
        proxy: http://127.0.0.1:7897
        keepModelDirect: true
```

4. 完全退出 DSH（托盘也要退），重新打开。

### 方式 B：作为 bundle 安装（发布到 npm 后）

```powershell
dsh plugin --profile web add dsh-egress-router
```

或在 Web UI：**设置 → 插件 → 添加插件**，填 `dsh-egress-router`。

> `desktop` profile 由桌面应用管理，不要用命令行 `dsh plugin --profile desktop`；桌面上请走 Web UI 的「添加插件」。
> 上面的 `web` 只是示例 profile 名，换成你自己的 profile。

本包带有 `dsh.bundle.patch`，bundle 安装会自己创建 `egress-router` 行。**不要**再按方式 A 手写 `insert`，否则会出现两条同 id 的条目。

> 方式 B 未在干净 DSH 上实测，建议先用 lab profile 验证。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` 时还原启动时的策略 |
| `mode` | `system` | `direct` / `system` / `manual` |
| `proxy` | `http://127.0.0.1:7897` | manual 模式的代理地址，只支持 `http://` / `https://` |
| `keepModelDirect` | `true` | 把 `deepseek.com` 加进 `NO_PROXY` |
| `noProxy` | `[]` | 额外直连主机（可写具体 IP / 主机名，不支持 `192.168.*` 这类网段） |
| `fallbackToDirect` | `true` | 代理不可用时回落直连 |
| `probeIntervalMs` | `5000` | 探测周期；`0` 关闭探测 |
| `probeTimeoutMs` | `800` | 单次探测超时 |

环境变量 kill switch：`DSH_EGRESS_DISABLE=1` 时插件完全不接管。

## Web UI

**设置 → 通用 → 出站分流**：

- 下拉框：全部直连 / 跟随系统 / 手动代理；
- 手动模式显示代理地址输入框；
- 「模型请求直连」复选框。

保存写入 profile 的 `cordis.patch.yml`，Host 收到配置更新后立即重新安装策略，无需重启。

## 验证

- 问模型一句话，能正常回复 → 模型直连正常；
- 让 agent 抓 `https://en.wikipedia.org/robots.txt` → 200 说明网页走了代理；
- 设置页能看到「出站分流」→ client 半边加载正常；
- 关掉 Clash，等 5～10 秒再抓外网 → 应报网络错误而不是卡死；重新打开 Clash 后应自动恢复。

## 安全设计

1. `apply()` 不读写文件、不探测网络、不抛异常；
2. 所有探测/换策略都在 `setImmediate` 之后异步执行；
3. 任何失败（代理 URL 非法、注册表读失败、install 抛错）都回落直连；
4. 不使用 `setInterval`，定时器由插件生命周期管理并在卸载时清理；
5. 卸载/关闭时把启动时的策略还原，包括环境变量；
6. 不写任何 JSON / 状态文件，重启不会读到半截数据。

## 回退

1. 完全退出 DSH；
2. 删除 `cordis.patch.yml` 里本插件的 `- insert:` 块；
3. 重启；
4. 可选：删除 `profiles\<name>\node_modules\dsh-egress-router`。

不会影响 profile 里其他插件配置。

## 已知限制

- 只支持 HTTP(S) 代理；SOCKS 会被 `@deepseek-ai/dsh-http-proxy` 拒绝并跳过。
- Windows `ProxyOverride` 里的 `192.168.*`、`10.*`、CIDR 无法用共享匹配器表达，会被丢弃；`web_fetch` 本来就拒绝私有地址，所以只影响局域网 MCP / 子进程访问内网设备。需要时用 `noProxy` 列出具体主机。
- Clash 的 fake-ip 模式（DNS 返回 `198.18.0.0/15`）不影响走代理的请求；只在“回落直连”时可能被 DSH 的私有地址校验拦住。
- 代理地址不要写带账号密码的 URL（会明文落盘）。
- `system` 模式只读 Windows 注册表；macOS / Linux 只读启动环境变量。

## 开发

无构建步骤；`lib/client.js` 是手写的 `window.__ModuleLoader__` bundle。

```powershell
node test/policy.test.mjs
```

## License

[MIT](./LICENSE)
