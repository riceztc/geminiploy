<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1pp4Ex5CVJ7L6V_SFMc46u14bHpMZQFCL

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


您拥有一台服务器，请按照以下步骤部署后端服务，以支持真实联机：
准备环境: 确保您的服务器已安装 Node.js。
创建目录: 在服务器上创建一个文件夹（例如 monopoly-server）。
初始化项目: 进入文件夹并运行 npm init -y。
安装依赖: 运行 npm install socket.io。
创建文件: 将下方提供的 server.js 代码保存到该文件夹中。
启动服务: 运行 node server.js。服务将在 3001 端口启动。
配置防火墙: 确保服务器的防火墙允许 3001 端口的 TCP 流量。
连接配置: 在下方更新的 App.tsx 代码中，找到 SOCKET_URL 常量，将其修改为您服务器的 公网 IP 地址 (例如 http://123.45.67.89:3001)。默认配置为 localhost 用于本地测试。
