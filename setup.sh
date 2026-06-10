#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=== KeyActivity Kurulum ==="

# 1. Ikonlari olustur
echo ""
echo ">> Ikonlar olusturuluyor..."
python3 icons/generate_icons.py

# 2. SheetJS indir (Excel destegi icin)
echo ""
echo ">> SheetJS (xlsx.min.js) indiriliyor..."
if command -v curl &>/dev/null; then
  curl -fsSL "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" -o lib/xlsx.min.js
elif command -v wget &>/dev/null; then
  wget -q "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" -O lib/xlsx.min.js
else
  echo "UYARI: curl veya wget bulunamadi. xlsx.min.js manuel olarak indirin:"
  echo "  https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
  echo "  -> lib/xlsx.min.js olarak kaydedin"
fi

if [ -f lib/xlsx.min.js ]; then
  echo "  xlsx.min.js hazir ($(wc -c < lib/xlsx.min.js) bytes)"
else
  echo "  UYARI: xlsx.min.js bulunamadi. Yalnizca CSV destegi aktif olacak."
fi

echo ""
echo "=== Kurulum Tamamlandi ==="
echo ""
echo "Eklentiyi Chrome'a yuklemek icin:"
echo "  1. chrome://extensions adresini acin"
echo "  2. 'Gelistirici modu'nu acin"
echo "  3. 'Paketsiz uzanti yukle' tiklayin"
echo "  4. Bu klasoru secin: $(pwd)"
echo ""
