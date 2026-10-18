# Changelog

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
