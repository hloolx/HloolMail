# 默认头像生成规范

默认头像资源位于 `web/public/avatars/defaults/`，文件名固定为 `avatar-0.png` 到 `avatar-9.png`、`avatar-a.png` 到 `avatar-z.png`。前端会按照昵称首字母选择同名文件；非字母数字首字会稳定哈希到这 36 张头像之一。

## 模型生成提示

推荐用图像模型按下面的规范批量生成，并覆盖同名文件：

```text
Use case: stylized-concept
Asset type: compact app default avatar
Primary request: create one square AI-generated default user avatar for the initial "{KEY}".
Subject: a friendly fictional human portrait, varied gender presentation across the full set, clean anime-inspired minimal illustration.
Style/medium: polished compact avatar, simple anime, restrained SaaS console aesthetic, crisp facial silhouette, no photorealism.
Composition/framing: centered bust portrait, generous safe margin, readable at 32px, rounded-square crop safe.
Lighting/mood: calm, modern, approachable, subtle depth.
Color palette: dark neutral base with one vivid accent color; vary accents across the set.
Text (verbatim): "{KEY}"
Constraints: include a small unobtrusive "{KEY}" badge in the lower-right corner; no logo; no watermark; no extra words; no brand marks.
Avoid: busy backgrounds, horror, weapons, celebrity likeness, realistic ID photo, oversized text, tiny unreadable details.
```

Replace `{KEY}` with each value in `0 1 2 3 4 5 6 7 8 9 a b c d e f g h i j k l m n o p q r s t u v w x y z`.

## 批量生成建议

Use `gpt-image-2` or the current project-approved image model, square `1024x1024`, medium or high quality, and concurrency around 5 to avoid rate limits. Save the final PNGs with the existing file names so the front-end mapping does not change.
