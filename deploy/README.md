# Enterprise Private Deployment Guide

English | [中文](README.zh.md)

This directory provides the production deployment configuration for deploying the customized DeepSeek Harness (DSH) together with WorkFusion on private enterprise infrastructure.

## Architecture

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

## Quick Start

1. Copy the environment configuration template:
   ```bash
   cp deploy/.env.enterprise.example deploy/.env.enterprise
   ```
2. Edit `deploy/.env.enterprise` and fill in:
   - `POSTGRES_PASSWORD`: database password
   - `JWT_SECRET_KEY`: WorkFusion user JWT key (>= 32 chars)
   - `DSH_SERVICE_TOKEN`: shared secret for DSH-to-WorkFusion delegation exchange
   - `DEEPSEEK_API_KEY`: API key for the DeepSeek agent loop
   - `DASHSCOPE_API_KEY`: API key for WorkFusion tender parsing (qwen-long)

3. Start all services:
   ```bash
   docker compose -f deploy/docker-compose.enterprise.yml --env-file deploy/.env.enterprise up -d
   ```

4. Initialize the database (first run only):
   ```bash
   docker compose -f deploy/docker-compose.enterprise.yml exec workfusion-api alembic upgrade head
   ```

5. Access the DSH enterprise workbench at `http://<host>:3080/`.
