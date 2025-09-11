#!/usr/bin/env bash
set -euo pipefail

OUT="assistant_bundle_$(date +%Y%m%d_%H%M%S)"
EXCLUDE_DIRS_REGEX='^(\.git/|node_modules/|dist/|build/|\.next/|\.cache/|coverage/|out/|target/|vendor/)'
MAX_PER_FILE=$((200*1024))
MAX_TOTAL=$((20*1024*1024))

mkdir -p "$OUT/_meta"

# Все файлы: отслеживаемые и неотслеживаемые (кроме игнорируемых)
git ls-files -co --exclude-standard > "$OUT/_meta/all_files.list"

# Файлы для упаковки (без тяжёлых директорий)
grep -Ev '^\s*$' "$OUT/_meta/all_files.list" \
  | grep -Ev "$EXCLUDE_DIRS_REGEX" \
  > "$OUT/_meta/include_files.list"

# ⚠️ исключаем сам скрипт (чтобы PowerShell не ругался на lock)
SCRIPT_NAME="$(basename "$0")"
grep -Ev "^${SCRIPT_NAME//\./\\.}$" "$OUT/_meta/include_files.list" > "$OUT/_meta/include_files.tmp"
mv "$OUT/_meta/include_files.tmp" "$OUT/_meta/include_files.list"

# Дерево
if command -v tree >/dev/null 2>&1; then
  tree -a -I '.git' > "$OUT/PROJECT_TREE.txt" || true
else
  { echo "# Project file list"; echo; sed 's/^/ - /' "$OUT/_meta/all_files.list"; } > "$OUT/PROJECT_TREE.txt"
fi

# MANIFEST.tsv
{
  echo -e "size_bytes\tsha1\tpath"
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    sz=$(wc -c < "$f" | tr -d '[:space:]')
    sha=$(git hash-object "$f" 2>/dev/null || echo "-")
    printf "%s\t%s\t%s\n" "$sz" "$sha" "$f"
  done < "$OUT/_meta/all_files.list"
} > "$OUT/MANIFEST.tsv"

# BINARIES.tsv
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

# CONTENTS.md (только текстовые файлы, с лимитами)
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

# README
cat > "$OUT/README_FOR_CHAT.md" <<EOF
# Assistant export
- PROJECT_TREE.txt — дерево/список файлов.
- MANIFEST.tsv — размер/sha1/путь каждого файла.
- BINARIES.tsv — бинарные файлы.
- CONTENTS.md — содержимое текстовых файлов (с лимитами).
EOF

# Упаковка
ZIP="$OUT.zip"

# Ищем 7z даже вне PATH
SEVENZ=""
for cand in 7z "/c/Program Files/7-Zip/7z.exe" "/c/Program Files (x86)/7-Zip/7z.exe" "/c/Tools/7-Zip/7z.exe"; do
  if command -v "$cand" >/dev/null 2>&1; then SEVENZ="$cand"; break; fi
  [ -x "$cand" ] && SEVENZ="$cand" && break
done

if command -v zip >/dev/null 2>&1; then
  zip -q -@ "$ZIP" < "$OUT/_meta/include_files.list"
  zip -qr "$ZIP" "$OUT"
elif [ -n "$SEVENZ" ]; then
  "$SEVENZ" a -tzip "$ZIP" @"$OUT/_meta/include_files.list" >/dev/null
  "$SEVENZ" a -tzip "$ZIP" "$OUT" >/dev/null
elif command -v powershell.exe >/dev/null 2>&1; then
  WINPWD=$(pwd -W 2>/dev/null || pwd)
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
    \$ErrorActionPreference = 'Stop';
    Set-Location -LiteralPath '$WINPWD';
    \$listPath = '$OUT/_meta/include_files.list';
    if (Test-Path -LiteralPath \$listPath) {
      \$paths = Get-Content -LiteralPath \$listPath | Where-Object { \$_ -and (Test-Path -LiteralPath \$_) };
    } else {
      \$paths = @();
    }
    if (\$paths.Count -gt 0) {
      Compress-Archive -Path \$paths -DestinationPath '$ZIP' -Force;
    } else {
      if (Test-Path '$ZIP') { Remove-Item -LiteralPath '$ZIP' -Force -EA SilentlyContinue }
      New-Item -ItemType File -Path '$ZIP' -Force | Out-Null
    }
    Compress-Archive -Path '$OUT' -DestinationPath '$ZIP' -Update -Force;
  "
else
  echo "Нужен 'zip', '7z' или PowerShell Compress-Archive в PATH." >&2
  exit 1
fi

echo "✅ Готово: $ZIP"
echo "   Смотри также $OUT/CONTENTS.md и $OUT/PROJECT_TREE.txt"
