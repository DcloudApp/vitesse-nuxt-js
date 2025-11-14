# GitHub Actions 自动部署到宝塔面板

本指南将帮助你配置 GitHub Actions，通过 Docker 镜像在宝塔面板服务器上部署 Nuxt SSR 应用。

## 前置准备

### 1. 服务器端环境

确保宝塔面板服务器满足以下条件：

1. 已安装 **Docker 20+**（推荐同时安装 Docker Compose，便于后续扩展）
2. SSH 远程登录正常
3. 已创建部署目录（示例：`/www/wwwroot/my-nuxt-app`）

#### 安装 Docker（示例脚本）

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 创建部署目录
mkdir -p /www/wwwroot/my-nuxt-app
```

#### 生成部署专用 SSH 密钥

为了避免影响日常登录，推荐为 GitHub Actions 创建“部署专用密钥”：

```bash
# 生成无密码密钥（推荐 ed25519，如不支持可换成 rsa 4096）
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy -N ""

# 将公钥写入授权列表
cat ~/.ssh/github_actions_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

> **可选加强**：编辑 `~/.ssh/authorized_keys`，在这一行前加入 `from="<your-github-actions-ip-range>"`、`command="..."` 等限制，降低权限暴露。

在服务器上验证密钥可用：

```bash
ssh -i ~/.ssh/github_actions_deploy root@your-server-ip
```

若连接无需密码即可进入，说明密钥配置成功。

### 2. 配置 GitHub Secrets

在 GitHub 仓库中配置以下 Secrets：

1. 进入你的 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret** 添加以下密钥：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `BT_HOST` | 服务器 IP 地址或域名 | `123.456.789.0` 或 `your-server.com` |
| `BT_USERNAME` | SSH 用户名（通常是 `root`） | `root` |
| `BT_SSH_KEY` | 服务器私钥内容 | 复制 `~/.ssh/github_actions_deploy` 的完整内容 |
| `BT_SSH_PORT` | SSH 端口（可选，默认 22） | `22` |
| `BT_DEPLOY_PATH` | 部署路径（可选，默认 `/www/wwwroot/my-nuxt-app`） | `/www/wwwroot/my-nuxt-app` |
| `BT_APP_NAME` | Docker 容器名称（可选，默认 `my-nuxt-app`） | `nuxt-prod` |
| `BT_APP_PORT` | 宿主机暴露端口（可选，默认 `3000`） | `8080` |
| `BT_SSH_KEY_PASSPHRASE` | 若保留口令，可填写（建议使用无密码部署密钥） | `your-passphrase` |

> 如果上述可选项不填，workflow 会自动使用默认值；只在需要自定义时添加 Secret。建议将生成的私钥 **只** 存在 GitHub Secrets 中，不要上传到仓库或共享给他人。

#### 如何获取 SSH 私钥

在服务器上执行：

```bash
cat ~/.ssh/github_actions_deploy
```

复制输出的完整内容（包括 `-----BEGIN OPENSSH PRIVATE KEY-----` 和 `-----END OPENSSH PRIVATE KEY-----`），粘贴到 GitHub Secrets 的 `BT_SSH_KEY` 中。

### 3. 配置 Nginx（如果还未配置）

在宝塔面板中配置 Nginx 反向代理：

1. 进入 **网站** → 添加站点
2. 填写域名或 IP
3. 在站点设置 → **配置文件** 中添加：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 部署流程

配置完成后，每次推送到 `main` 分支时，GitHub Actions 会自动：

1. ✅ 检出代码
2. ✅ 使用 Dockerfile 构建镜像 `my-nuxt-app:<git-sha>`
3. ✅ 将镜像导出为 `my-nuxt-app.tar.gz`
4. ✅ 通过 SSH 上传镜像包到宝塔服务器
5. ✅ 在服务器上 `docker load` 镜像
6. ✅ 停止旧容器并以新镜像重新运行

## 手动触发部署

如果需要手动触发部署：

1. 进入 GitHub 仓库的 **Actions** 标签页
2. 选择 **Deploy via Docker** workflow
3. 点击 **Run workflow**

## 查看部署日志

1. 在 GitHub 仓库的 **Actions** 标签页查看部署状态
2. 点击具体的 workflow run 查看详细日志
3. 如果部署失败，检查日志中的错误信息

## 服务器端管理命令

部署后，可以在服务器上使用以下命令管理容器：

```bash
# 查看容器
docker ps -a | grep my-nuxt-app

# 查看日志
docker logs -f my-nuxt-app

# 重启容器
docker restart my-nuxt-app

# 停止并删除容器
docker rm -f my-nuxt-app
```

## 回滚部署

如果需要回滚到之前的镜像版本，可以：

```bash
# 列出历史镜像
docker images my-nuxt-app

# 停止当前容器
docker rm -f my-nuxt-app

# 启动旧版本（替换 <old-tag>）
docker run -d \
  --name my-nuxt-app \
  --restart always \
  -p 3000:3000 \
  -e NODE_ENV=production \
  my-nuxt-app:<old-tag>
```

## 故障排查

### 1. 部署失败：SSH 连接失败

- 检查 `BT_HOST`、`BT_USERNAME`、`BT_SSH_PORT` 是否正确
- 检查服务器防火墙是否开放 SSH 端口
- 验证 SSH 密钥是否正确配置

### 2. Docker 命令不可用

- 确认已安装 Docker，并且当前用户在 `docker` 组内
- 执行 `docker info` 验证服务状态

### 3. 容器未启动或立即退出

- 运行 `docker logs my-nuxt-app` 查看报错
- 检查宿主机端口（默认 3000 或 `BT_APP_PORT`）是否被占用

### 4. Nginx 返回 502

- 确认容器处于运行状态：`docker ps | grep my-nuxt-app`
- 确认 Nginx 的 `proxy_pass` 指向容器暴露端口（默认 3000）
- 查看 Nginx 错误日志定位原因

## 安全建议

1. **使用专用 SSH 密钥**：不要使用服务器的主密钥，创建专用的部署密钥
2. **限制 SSH 访问**：在宝塔面板中配置 SSH 访问白名单
3. **定期更新密钥**：定期轮换 SSH 密钥
4. **监控部署**：设置部署通知（邮件、Slack 等）

## 高级配置

### 多环境部署

如果需要部署到多个环境（开发、生产），可以：

1. 创建多个 workflow 文件（如 `deploy-dev.yml`、`deploy-prod.yml`）
2. 使用不同的分支触发（如 `develop` → 开发环境，`main` → 生产环境）
3. 配置不同的 Secrets（如 `BT_HOST_DEV`、`BT_HOST_PROD`）

### 部署前测试

在 `.github/workflows/deploy.yml` 中添加测试步骤：

```yaml
- name: Run tests
  run: pnpm test  # 如果有测试脚本
```

### 通知配置

添加部署成功/失败通知（Slack、钉钉、企业微信等）：

```yaml
- name: Notify on success
  if: success()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: '部署成功！'
```

