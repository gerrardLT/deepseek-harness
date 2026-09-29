# 企业私有化部署手册

[English](README.md) | 中文

本目录提供定制版 DeepSeek Harness（DSH）与 WorkFusion 在企业私有化基础设施上协同运行的生产级部署配置。

## 架构

```text
[ User Browser ]
       │
       ▼ (Port 3080)
[ dsh-enterprise ] ── (HTTP /api/agent/*) ──► [ workfusion-api ]
  - DSH Web Workbench                          - Tender parsing & Graph-RAG
  - Agent runtime & Tools                      - Section generation (LLM Router)
  - Auto-refreshing delegation JWT             - DOCX Export & Packaging
  - Session event logs                         - PostgreSQL database
```

## 快速开始

1. 复制环境变量配置模板：
   ```bash
   cp deploy/.env.enterprise.example deploy/.env.enterprise
   ```
2. 编辑 `deploy/.env.enterprise` 并配置以下项：
   - `POSTGRES_PASSWORD`: 数据库密码
   - `JWT_SECRET_KEY`: WorkFusion 用户登录 JWT 密钥（>= 32 字符）
   - `DSH_SERVICE_TOKEN`: DSH 与 WorkFusion 换取委托 token 的服务共享凭证
   - `DEEPSEEK_API_KEY`: DeepSeek Agent 循环调用模型密钥
   - `DASHSCOPE_API_KEY`: WorkFusion 标书解析调用 qwen-long 的密钥

3. 启动全套服务：
   ```bash
   docker compose -f deploy/docker-compose.enterprise.yml --env-file deploy/.env.enterprise up -d
   ```

4. 执行数据库迁移（仅首次启动需执行）：
   ```bash
   docker compose -f deploy/docker-compose.enterprise.yml exec workfusion-api alembic upgrade head
   ```

5. 访问 DSH 企业智能工作台：`http://<host>:3080/`。
