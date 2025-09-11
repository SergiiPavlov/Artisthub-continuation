#!/usr/bin/env bash
set -euo pipefail

OUT="assistant_bundle_$(date +%Y%m%d_%H%M%S)"
EXCLUDE_DIRS_REGEX='^(\.git/|node_modules/|dist/|build/|\.next/|\.cache/|coverage/|out/|target/|vendor/)'
MAX_PER_FILE=$((200*1024))   # лимит на файл для CONTENTS.md
MAX_TOTAL=$((20*1024*1024))  # общий лимит CONTENTS.md

mkdir -p "$OUT/_meta" "$OUT/_snapshot"

# 1) Все файлы: отслеживаемые и неотслеживаемые (кроме игнорируемых git'ом)
git ls-files -co --exclude-standard > "$OUT/_meta/all_files.list"

# 2) Файлы для снапшота/упаковки (без тяжёлых директорий)
grep -Ev '^\s*$' "$OUT/_meta/all_files.list" \
  | grep -Ev "$EXCLUDE_DIRS_REGEX" \
  > "$OUT/_meta/include_files.list"

# 2a) исключаем сам скрипт
SCRIPT_NAME="$(basename "$0")"
grep -Ev "^${SCRIPT_NAME//\./\\.}$" "$OUT/_meta/include_files.list" > "$OUT/_meta/include_files.tmp"
mv "$OUT/_meta/include_files.tmp" "$OUT/_meta/include_files.list"

# 3) Дерево
if command -v tree >/dev/null 2>&1; then
  tree -a -I '.git' > "$OUT/PROJECT_TREE.txt" || true
else
  { echo "# Project file list"; echo; sed 's/^/ - /' "$OUT/_meta/all_files.list"; } > "$OUT/PROJECT_TREE.txt"
fi

# 4) MANIFEST.tsv по всем файлам (включая исключённые каталоги — только для справки)
{
  echo -e "size_bytes\tsha1\tpath"
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    sz=$(wc -c < "$f" | tr -d '[:space:]')
    sha=$(git hash-object "$f" 2>/dev/null || echo "-")
    printf "%s\t%s\t%s\n" "$sz" "$sha" "$f"
  done < "$OUT/_meta/all_files.list"
} > "$OUT/MANIFEST.tsv"

# 5) BINARIES.tsv среди включаемых файлов
{
  echo -e "size_bytes\tmimetype\tpath"
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    if ! grep -Iq . "$f" 2>/dev/null; then
      sz=$(wc -c < "$f" | tr -d '[:space:]')
      if command -v file >/dev/null 2>&1; then mt=$(file -b --mime-type "$f" || echo "binary"); else mt="binary"; fi
      printf "%s\t%s\t%s\n" "$sz" "$mt" "$f"
    fi
  done < "$OUT/_meta/include_files.list"
} > "$OUT/BINARIES.tsv"

# 6) CONTENTS.md (только текстовые, с лимитами)
TOTAL=0
CAT="$OUT/CONTENTS.md"
echo "# Project contents (text files, truncated)" > "$CAT"; echo >> "$CAT"

detect_lang() {
  case "${1##*.}" in
    js) echo "javascript";; ts) echo "typescript";; jsx|tsx) echo "tsx";;
    json) echo "json";; yml|yaml) echo "yaml";; md) echo "markdown";;
    sh|bash) echo "bash";; html|htm) echo "html";; css) echo "css";;
    py) echo "python";; go) echo "go";; java) echo "java";; rb) echo "ruby";;
    php) echo "php";; rs) echo "rust";; c) echo "c";; cpp|cc|cxx) echo "cpp";;
    cs) echo "csharp";; sql) echo "sql";; xml) echo "xml";; *) echo "text";;
  esac
}

while IFS= read -r f; do
  [ -e "$f" ] || continue
  if ! grep -Iq . "$f" 2>/dev/null; then continue; fi
  sz=$(wc -c < "$f" | tr -d '[:space:]')
  if [ "$sz" -gt "$MAX_PER_FILE" ]; then
    echo -e "\n---\n## $f (skipped, $sz bytes > $MAX_PER_FILE)\n" >> "$CAT"
    continue
  fi
  if [ "$TOTAL" -ge "$MAX_TOTAL" ]; then
    echo -e "\n\n> Reached MAX_TOTAL=$MAX_TOTAL bytes for CONTENTS.md — further files skipped." >> "$CAT"
    break
  fi
  lang=$(detect_lang "$f"); sha=$(git hash-object "$f" 2>/dev/null || echo "-")
  echo -e "\n---\n## $f\n" >> "$CAT"
  echo -e "**size:** $sz bytes &nbsp;&nbsp; **sha1:** \`$sha\`\n" >> "$CAT"
  echo -e "\`\`\`$lang" >> "$CAT"; cat "$f" >> "$CAT"; echo -e "\n\`\`\`" >> "$CAT"
  TOTAL=$((TOTAL + sz))
done < "$OUT/_meta/include_files.list"

# 7) СНАПШОТ файлов проекта под $OUT/_snapshot (с сохранением структуры)
while IFS= read -r f; do
  [ -e "$f" ] || continue
  d="$OUT/_snapshot/$(dirname "$f")"
  mkdir -p "$d"
  cp -p "$f" "$OUT/_snapshot/$f"
done < "$OUT/_meta/include_files.list"

# 8) README
cat > "$OUT/README_FOR_CHAT.md" <<EOF
# Assistant export
- PROJECT_TREE.txt — дерево/список файлов.
- MANIFEST.tsv — размер/sha1/путь каждого файла.
- BINARIES.tsv — бинарные файлы.
- CONTENTS.md — содержимое текстовых файлов (с лимитами).
- _snapshot/ — копия проекта (без node_modules и т.п.) для оффлайн-обзора.
EOF

# 9) Упаковка: архивируем ТОЛЬКО $OUT (без Update)
ZIP="$OUT.zip"

# Ищем 7z даже вне PATH
SEVENZ=""
for cand in 7z "/c/Program Files/7-Zip/7z.exe" "/c/Program Files (x86)/7-Zip/7z.exe" "/c/Tools/7-Zip/7z.exe"; do
  if command -v "$cand" >/dev/null 2>&1; then SEVENZ="$cand"; break; fi
  [ -x "$cand" ] && SEVENZ="$cand" && break
done

if command -v zip >/dev/null 2>&1; then
  zip -qr "$ZIP" "$OUT"
elif [ -n "$SEVENZ" ]; then
  "$SEVENZ" a -tzip "$ZIP" "$OUT" >/dev/null
elif command -v powershell.exe >/dev/null 2>&1; then
  WINPWD=$(pwd -W 2>/dev/null || pwd)
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
    \$ErrorActionPreference = 'Stop';
    Set-Location -LiteralPath '$WINPWD';
    if (Test-Path -LiteralPath '$ZIP') { Remove-Item -LiteralPath '$ZIP' -Force -EA SilentlyContinue }
    Compress-Archive -Path '$OUT' -DestinationPath '$ZIP' -Force;
  "
else
  echo "Нужен 'zip', '7z' или PowerShell Compress-Archive." >&2
  exit 1
fi

echo "✅ Готово: $ZIP"
echo "   Смотри также $OUT/CONTENTS.md и $OUT/PROJECT_TREE.txt"
