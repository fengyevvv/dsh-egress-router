# Changelog

## 0.1.3

- 健康检查改为**通过代理实际发 HTTP 请求**（默认 `https://www.gstatic.com/generate_204`），能发现“端口开着但上游坏了”。
- 新增 `emergencyDirectHosts`：代理不可用时只有名单内域名直连，名单外请求保持失败关闭，避免真实 IP 泄露。
- 代理恢复后，名单内域名自动回到代理。
- `fallbackToDirect` 默认改为 `false`；设为 `true` 才恢复“全部直连”的旧行为。
- Web UI 增加「应急直连」列表（添加/删除），默认空。

## 0.1.2

- 兼容 DSH `0.2.1-rc.5`：新增 `engines.dsh` 范围，放宽 `@deepseek-ai/dsh-*` peer 版本。
- 修复新版 DSH 把插件误判为不兼容、启动时禁用的问题。
- 行为与 API 未变，仍使用 `installProxyFromEnvironment` / `launchEnvironmentOf`。

## 0.1.1

- 默认模式改为 `system`（Config schema、bundle patch、README 同步）。
- 未知 / 非法 `mode` 的兜底值改为 `system`：只会降级为直连，不会退回写死的代理地址。
- 单测同步更新（17 项）。

## 0.1.0

- 首个版本：`direct` / `system` / `manual` 三种模式。
- 通过 `@deepseek-ai/dsh-http-proxy` 的进程级策略接管 `web_fetch` 与全局 dispatcher。
- Windows 注册表系统代理探测。
- TCP 健康探测与自动回落直连。
- Web UI：设置 → 通用 → 出站分流。
