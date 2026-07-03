# uniauto 需求清单评估(2026-07-03)

> 评估对象:`docs/better-agent-需求清单.md`(uniauto 对 better-agent 的 8 条需求)。
> 结论先行:**7/8 条是加法或文档工作,唯 P0-1(多模态工具结果)是结构性改动** —— 但按下述路线可做到对现有 agent 零破坏。动手时先出 P0-1 的 spec,它决定其它几条的形状。

## 按破坏性排序

### P0-1 多模态工具结果 —— 唯一伤筋动骨的一条

**破坏面**:`ExecuteResult.output: string` 的字符串假设贯穿全链路 ——
- `tool/registry.ts`:截断(truncateOutput)、doom-loop 判重、isError 抛错都按字符串处理;
- **part 持久化形状**:tool-result 的 jsonb `result` → 历史回放 + 聊天 UI(ToolInvocation 渲染);
- `to-model-messages.ts` 工具结果回放;
- client SDK `submitToolResult` 的 zod 与 Redis pending 存储。

**建议路线(零破坏)**:
1. **不改 `output`,新增可选 `content?: ToolResultContent[]`**(加法而非改法)—— 旧行为原样,新路径按需启用;
2. **image-ref 优先**(attachmentId 引用,服务端解析),base64 仅限小图 —— 也避开 Upstash REST 的 payload 上限;
3. **一期只承诺 Anthropic**。

**清单没提但必须面对的三件事**:
1. **Provider 兼容是地雷**:Anthropic 支持 tool_result 带图,**OpenAI chat-completions 不支持** —— 需要降级策略(不支持的 provider 把图注入为后续 user 消息);
2. **图片会杀死 prompt cache + 撑爆上下文**:每步一张截图 × ReAct 几十步 → 必须配"**图片老化**"(历史回放只保留最近 N 张,老图替换为文本占位),这也是 image-ref 优于 base64 的深层理由;
3. **doom-loop 会误伤 UI 自动化**:同工具同参数连打(重试点击/重截屏)在 uniauto 场景是合法的,现在连续 3 次即拦 —— **P2-6 的可配置化实际是 P0-1 的隐性前置**。

### P0-2 Agent 开通 API —— 基本已存在,缺"编程化入口 + 文档"

agents.create/update、token 签发(revealToken)、systemPrompt/模型/参数配置全部现成。真正要决策的是**认证形态**:uniauto 后端以什么身份调用?
- 方案 A:服务账号用户 + 密码登录换 JWT(丑但零改动);
- 方案 B:长期 API key(新机制,需设计安全面:scope、轮换、审计)。

这是产品决策,不是工程难点。定了方案后补一份最小示例文档即可验收。

### P1-5 可恢复取消 —— 语义上已经成立

cancel 只中止当前回合;parts 渐进落库、会话历史保留、同 sessionId 继续 run 自带全量上下文。缺的只是**保证性测试 + 文档承诺**(约半天)。

### 其余五条:低风险加法

| 条目 | 工作量 | 要点 |
|---|---|---|
| P1-3 挂起 TTL 可配/心跳 | 小 | 硬编码 120s → 按 agent/run/tool 配置;注意 Redis TTL 与 `setTimeout` **两处**要同步;心跳=新端点 |
| P1-4 按 run 选模型 + 降级 | 中 | `RunOptions.modelId` 覆盖 + 按 errorCategory 的降级链;每消息已存 modelId,成本归因现成;注意换模型会破 prompt cache(可接受) |
| P2-6 doom-loop 配置 + 事件 | 小 | 阈值进 agent params;新增 `RunEvent` 类型需同步 client 类型;UI 对未知事件本就安全落空 |
| P2-7 用量/成本粒度 | 小 | `done.usage` 已有;step 级是加字段 |
| P2-8 附件限制/留存 | 纯文档 | 上限/留存现在确实没写,补文档即可 |

## 建议实施顺序

1. **P0-1 spec 先行**(含 provider 降级、图片老化、image-ref 通道)→ 实现(一期 Anthropic);
2. P2-6(doom-loop 可配)与 P0-1 同批做(前置依赖);
3. P0-2 的认证形态决策 → 文档 + 示例;
4. P1-5 保证性测试 + 文档(半天,随时可插队);
5. P1-3 / P1-4 / P2-7 / P2-8 按 uniauto 一期进度排。
