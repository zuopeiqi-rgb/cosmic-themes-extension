# ChatGPT Sol · Terra · Luna WebGL v2.3

用于 `https://chatgpt.com/*` 的本地 Chrome / Edge Manifest V3 视觉扩展。

## v2.3 更新

- Sol、Terra、Luna 均增加三层实时发光粒子环：外层柔光、内层辉光、清晰粒子核心。
- 大气层 / 日冕改为双层粒子壳，星球边缘发光更强、更连续。
- 模型切换改为长缓动相机轨迹：后退、深空弧线移动、粒子形态重组、平稳接近。
- 快速连续切换时不再中途跳变，而是按最新选择自然排队衔接。
- 新增实时设置：
  - 场景亮度
  - 星球大小
  - 粒子强度
  - 发光强度
  - 环绕密度
  - 粒子速度
  - 水平位置
  - 垂直位置
  - 转场时长
  - 文字保护
  - 整体视觉强度
  - 渲染质量

## 安装

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择包含 `manifest.json` 的 `chatgpt-cosmic-webgl-extension-v2.3` 文件夹。
5. 关闭旧版同类扩展，刷新 `chatgpt.com`。

## 隐私

扩展仅检查模型选择控件中的 Sol / Terra / Luna 名称，不读取聊天正文、输入内容、Cookie 或网络请求，也不上传数据。


## v2.3 UI refinement

- Composer and user-message materials now follow ChatGPT's native dark UI geometry instead of using large theme-colored brown/blue panels.
- Sol particles, corona and orbital trails are reduced and refined with theme-specific scaling.
- Legacy v2.2 high-intensity defaults are migrated to calmer recommended values on first v2.3 run.
