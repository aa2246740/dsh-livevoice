# dsh-livevoice

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接 Codex realtime 语音：`Ctrl+L` / `/live`。

这是 omp GPT-Live 路径的协议移植：ChatGPT OAuth、WebRTC、Frameless Bidi、把活派回当前 DSH 会话。不是本地 STT/TTS。

当前源码面向 DeepSeek Harness `dsh-v0.1.2-rc.1`。浏览器半边要对着目标 Harness 检出构建：

```sh
pnpm install --frozen-lockfile
DSHX_HARNESS=/absolute/path/to/deepseek-harness pnpm build
```

## 登录

不能用普通 OpenAI 平台 API key，也不能用默认 DeepSeek LLM 登录。信令打到 `https://chatgpt.com/backend-api/codex/realtime/calls`，带 ChatGPT / Codex OAuth access token，originator 是 `Codex Desktop`。

不依赖 `dsh-oauth-login` 是否加载。凭据按这个顺序读：

1. `$DSH_HOME/.dsh-oauth-auth.json` 里的 `openai-codex`，由 dsh-oauth-login / 订阅登录写入
2. DSH 凭据库 `llm-pi-ai/openai-codex`，官方设置 → 模型 → ChatGPT Codex OAuth
3. `~/.codex/auth.json`，官方 `codex login`，只读兜底

一个都没有时，Live 按钮报 `No Codex OAuth credential is available for a live call.`

## 使用

输入框 **Live** 按钮，或 `Ctrl+L`，或 `/live`。Esc 挂断。Live 条聚焦时 Space 静音。

语音模型是 `gpt-live-1-codex`，只负责说话。仓库工作派回当前 DSH 会话。声音名和 Codex 一样：arbor, breeze, cove, ember, juniper, maple, sol, spruce, vale。

HTTP/WS 出站遵守 `$DSH_HOME/.dsh-oauth-proxy.json` 和 `HTTPS_PROXY`。
