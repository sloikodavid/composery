#!/usr/bin/env bash
# Fetch the real Apple system fonts the framing uses, into ./fonts/ (gitignored).
# They are Apple-licensed and large (~700 MB of installers), so they are never
# committed - the frame draws with the genuine SF Pro text and SF Symbols glyphs.
#
# Needs 7-Zip (to crack the .dmg -> .pkg -> cpio payloads). On Windows:
#   winget install -e --id 7zip.7zip
# Then: bash screenshots/fonts.sh
set -e
cd "$(dirname "$0")"
mkdir -p fonts

SZ="$(command -v 7z || command -v 7za || echo '/c/Program Files/7-Zip/7z.exe')"
[ -x "$SZ" ] || { echo "7-Zip not found. Install it, then re-run."; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
CDN="https://devimages-cdn.apple.com/design/resources/download"

echo "Downloading SF Pro + SF Symbols (~700 MB)..."
curl -sL -o "$tmp/pro.dmg" "$CDN/SF-Pro.dmg"
curl -sL -o "$tmp/sym.dmg" "$CDN/SF-Symbols-7.dmg"

# SF Pro Text: dmg -> pkg -> Payload (cpio) -> Library/Fonts/*.otf
"$SZ" e -y "$tmp/pro.dmg" "SFProFonts/SF Pro Fonts.pkg" -o"$tmp" >/dev/null
"$SZ" e -y "$tmp/SF Pro Fonts.pkg" "SFProFonts.pkg/Payload" -o"$tmp" >/dev/null
"$SZ" x -y "$tmp/Payload" -o"$tmp/pro" >/dev/null
"$SZ" x -y "$tmp/pro/Payload~" -o"$tmp/pro_x" >/dev/null
cp "$tmp/pro_x/Library/Fonts/SF-Pro-Text-Semibold.otf" fonts/
cp "$tmp/pro_x/Library/Fonts/SF-Pro-Text-Regular.otf" fonts/

# SF Symbols: the symbol glyphs live in the app bundle's fallback font.
"$SZ" e -y "$tmp/sym.dmg" "SFSymbols/SF Symbols.pkg" -o"$tmp" >/dev/null
"$SZ" e -y "$tmp/SF Symbols.pkg" -o"$tmp/sym_pkg" >/dev/null
"$SZ" x -y "$tmp/sym_pkg/Payload" -o"$tmp/sym_p" >/dev/null
"$SZ" x -y "$tmp/sym_p/Payload~" -o"$tmp/sym_x" >/dev/null
cp "$tmp/sym_x/Applications/SF Symbols.app/Contents/Resources/Fonts/SFSymbolsFallback.otf" fonts/SF-Symbols.otf

echo "Done:"; ls -la fonts/
