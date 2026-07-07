#!/usr/bin/env python3
"""
M_Viewer ビルドスクリプト
  src/template.html + src/style.css → index.html (ルート直下)
  ※ テンプレート内の <!-- INJECT:CSS --> を <style>CSS内容</style> に置換
  ※ GitHub → Vercel デプロイ対応(index.html がルートに出力される)
"""
import os, sys, hashlib

# ── 設定 ──────────────────────────────
VER = 'V7.01'                    # ★ バージョンアップ時はここを変更
BASE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(BASE, 'src')
TEMPLATE = os.path.join(SRC, 'template.html')
CSS_FILE = os.path.join(SRC, 'style.css')
OUTPUT   = os.path.join(BASE, 'index.html')   # ルート直下に出力
MARKER   = '<!-- INJECT:CSS -->'

# ── ビルド ─────────────────────────────
def build():
    with open(TEMPLATE, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()

    if MARKER not in html:
        print(f'✗ テンプレートに {MARKER} が見つかりません')
        sys.exit(1)

    # マーカーを <style>CSS</style> に置換
    html = html.replace(MARKER, f'<style>\n{css.rstrip()}\n</style>')

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(html)

    # 結果表示
    lines = html.count('\n') + 1
    size_kb = os.path.getsize(OUTPUT) / 1024
    md5 = hashlib.md5(html.encode('utf-8')).hexdigest()

    print(f'✓ ビルド完了: index.html ({VER})')
    print(f'  行数: {lines}')
    print(f'  サイズ: {size_kb:.1f} KB')
    print(f'  MD5: {md5}')

if __name__ == '__main__':
    build()
