#!/bin/sh
# Renders README.md with GitHub's own Markdown API (same sanitiser as the
# profile page) and wraps it in a GitHub-style frame at ../preview.html.
set -e
cd "$(dirname "$0")/.."

body=$(gh api -X POST markdown -f mode=gfm -f text="$(cat README.md)")

cat > preview.html <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>README Preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown-dark.min.css">
<style>
  body { margin: 0; background: #0d1117; }
  .page { max-width: 932px; margin: 32px auto; padding: 0 16px; }
  .box { border: 1px solid #30363d; border-radius: 6px; }
  .box-head { padding: 12px 24px; border-bottom: 1px solid #30363d; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #7d8590; }
  .markdown-body { padding: 24px; background: transparent; }
</style>
</head>
<body>
<div class="page">
  <div class="box">
    <div class="box-head">MuhammadMurtuzaHussain / README.md</div>
    <article class="markdown-body">
$body
    </article>
  </div>
</div>
</body>
</html>
EOF
echo "wrote $(pwd)/preview.html"
