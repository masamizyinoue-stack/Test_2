#!/usr/bin/env python3
"""
M_Viewer ビルドスクリプト
  src/template.html + src/style.css + src/*.js → index.html
  マーカー:
    <!-- INJECT:CSS -->         → <style>style.css内容</style>
    /* INJECT:ファイル名.js */  → 該当JSファイルの内容
"""
import os, sys, re, hashlib

# ── 設定 ──────────────────────────────
VER = 'V7.07'                    # ★ バージョンアップ時はここを変更
BASE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(BASE, 'src')
TEMPLATE = os.path.join(SRC, 'template.html')
CSS_FILE = os.path.join(SRC, 'style.css')
OUTPUT   = os.path.join(BASE, 'index.html')
CSS_MARKER = '<!-- INJECT:CSS -->'
JS_PATTERN = re.compile(r'/\* INJECT:(\S+\.js) \*/')

# ── ビルド ─────────────────────────────
def build():
    with open(TEMPLATE, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()

    # CSS注入
    if CSS_MARKER not in html:
        print(f'✗ テンプレートに {CSS_MARKER} が見つかりません'); sys.exit(1)
    html = html.replace(CSS_MARKER, f'<style>\n{css.rstrip()}\n</style>')

    # JS注入（各マーカーを対応するJSファイルの内容に置換）
    injected = []
    def _replace_js(m):
        fname = m.group(1)
        path = os.path.join(SRC, fname)
        if not os.path.exists(path):
            print(f'✗ {fname} が見つかりません'); sys.exit(1)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        injected.append(fname)
        # マーカー行を置換するので、末尾改行を1つだけ除去
        if content.endswith('\n'):
            content = content[:-1]
        return content

    html = JS_PATTERN.sub(_replace_js, html)

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(html)

    # 結果表示
    lines = html.count('\n') + 1
    size_kb = os.path.getsize(OUTPUT) / 1024
    md5 = hashlib.md5(html.encode('utf-8')).hexdigest()

    print(f'✓ ビルド完了: index.html ({VER})')
    print(f'  注入CSS: style.css')
    print(f'  注入JS:  {", ".join(injected)}')
    print(f'  行数: {lines}')
    print(f'  サイズ: {size_kb:.1f} KB')
    print(f'  MD5: {md5}')

if __name__ == '__main__':
    build()
