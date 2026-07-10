# 身份验证器 — Chrome TOTP Authenticator Extension

基于时间的一次性密码（TOTP）Chrome 扩展，支持扫码添加、一键填充和自动补全双重验证码。

## 功能

- **TOTP 生成** — 标准 RFC 6238 算法，Web Crypto API 实现，无外部依赖
- **一键填充** — 点击账号卡片任意区域，自动识别并填入当前页面的验证码输入框
- **扫码添加** — 截图当前标签页，自动识别二维码中的 `otpauth://totp/` 链接
- **手动添加** — 设置页支持手动输入服务商、账号名和 Base32 密钥
- **数据备份** — JSON 格式导出/导入，方便迁移
- **深色主题** — 经典身份验证器风格，卡片列表带圆形倒计时动画

## 安装

### 从源码加载（开发者模式）

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择本项目目录

### 从 Chrome 应用商店（待上架）

<!-- TODO: 上架后补充商店链接 -->

## 使用

### 添加账号

**扫码添加：**
1. 在网页上显示 TOTP 二维码（如 GitHub、阿里云等 2FA 设置页）
2. 点击扩展图标打开弹出窗口
3. 点击顶部工具栏的 **扫码图标**（📷）
4. 扩展会自动截图当前页面并识别二维码

**手动添加：**
1. 点击扩展图标 → 齿轮图标进入设置
2. 填写服务提供商、账号名、密钥（Base32 格式）
3. 点击"添加账号"

### 获取验证码

打开扩展弹出窗口，所有账号的 6 位动态码自动展示，每 30 秒刷新一次，右侧圆形进度条显示剩余时间。

### 填充验证码

- **点击卡片** — 点击任意账号卡片区域，自动填入当前页面的 2FA 输入框
- **点击"填充"按钮** — 鼠标悬停卡片时出现的快捷按钮

### 复制验证码

- 鼠标悬停卡片 → 点击 **"复制"** 按钮

### 管理账号

- **置顶** — 点击卡片右侧星标图标
- **删除** — 点击顶部 **编辑图标**（✏️）进入编辑模式，显示删除按钮
- **设置页** — 齿轮图标进入，可批量管理所有账号

## 技术栈

- **Manifest V3** — 最新 Chrome 扩展规范
- **原生 JavaScript** — 零框架依赖，ES Modules
- **Web Crypto API** — HMAC-SHA1 算法实现 TOTP
- **BarcodeDetector API** — 二维码识别（Shape Detection API）
- **chrome.storage.local** — 数据持久化
- **Content Script** — 自动填充 2FA 输入框

## 项目结构

```
auto-authenticator/
├── manifest.json        # 扩展配置
├── totp.js              # TOTP 算法核心
├── background.js        # 后台 Service Worker
├── content.js           # 自动填充脚本
├── popup.html           # 弹出窗口
├── popup.css            # 弹出窗口样式
├── popup.js             # 弹出窗口逻辑
├── settings.html        # 设置页面
├── settings.js          # 设置页面逻辑
└── icons/               # 扩展图标
```

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 保存账号密钥和配置 |
| `activeTab` | 截图当前页面以识别二维码 |
| `scripting` | 向页面注入自动填充脚本 |
| `<all_urls>` | 在所有网页上检测 2FA 输入框 |

## 开发

```bash
# 克隆仓库
git clone <repo-url>

# 直接加载为 Chrome 扩展即可开发
# 修改后刷新 chrome://extensions/ 页面重载
```

## License

MIT
