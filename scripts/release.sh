#!/usr/bin/env bash
# Versioned release: bump the app version, build the APK, render the covering note PDF,
# tag, push, and publish a GitHub release with both attached.
#
#   scripts/release.sh 1.1.0 "One-line summary of what changed"
#   scripts/release.sh 1.0.0 "…" --no-build   # publish the APK already in app/android/.../release
#
# Needs: gh (logged in), pandoc, google-chrome (headless), the Android toolchain under
# ~/.finn-build/android, and app/.env.production (API URL + app token; never committed).
set -euo pipefail

VERSION="${1:?version, e.g. 1.1.0}"
SUMMARY="${2:?one-line release summary}"
BUILD=1
[[ "${3:-}" == "--no-build" ]] && BUILD=0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
OUT="$ROOT/dist/v$VERSION"
APK_SRC="$APP/android/app/build/outputs/apk/release/app-release.apk"
TAG="v$VERSION"
mkdir -p "$OUT"

git -C "$ROOT" diff --quiet -- . ':!kb' ':!data' || { echo "commit your changes first" >&2; exit 1; }  # brain data churns; code must be clean
git -C "$ROOT" rev-parse "$TAG" >/dev/null 2>&1 && { echo "$TAG already exists" >&2; exit 1; }

if [[ $BUILD == 1 ]]; then
  echo "==> version $VERSION"
  python3 - "$APP/app.json" "$VERSION" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
d = json.load(open(p)); e = d["expo"]
e["version"] = v
e.setdefault("android", {})["versionCode"] = int(e["android"].get("versionCode", 1)) + 1
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
print("versionCode", e["android"]["versionCode"])
PY
  echo "==> prebuild + APK"
  (cd "$APP" && NODE_ENV=production npx expo prebuild --platform android --no-install >/dev/null)
  A="$HOME/.finn-build/android"
  (cd "$APP/android" && JAVA_HOME=$A/jdk17 ANDROID_HOME=$A/sdk ANDROID_SDK_ROOT=$A/sdk \
     GRADLE_USER_HOME=/run/media/rdksupe/finn/.gradle PATH=$A/jdk17/bin:$PATH NODE_ENV=production \
     ./gradlew assembleRelease --no-daemon -q)
  git -C "$ROOT" add app/app.json
  git -C "$ROOT" commit -q -m "Release $TAG"
fi

# Guard: the release build must point at production, never a dev server.
if unzip -p "$APK_SRC" assets/index.android.bundle | grep -aq "localhost:8000"; then
  echo "APK bundle points at localhost; refusing to release" >&2; exit 1
fi
cp "$APK_SRC" "$OUT/FINN-$VERSION.apk"

echo "==> covering note PDF"
CSS="$OUT/.note.css"
cat > "$CSS" <<'CSS'
@page { size: A4; margin: 18mm 18mm 20mm; }
body { font-family: "Public Sans", Arial, sans-serif; color: #14201E; font-size: 10.5pt; line-height: 1.5; }
h1 { font-family: "Josefin Sans", sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #F4F7F5; background: #1E4D47; padding: 14px 18px; font-size: 18pt; margin: 0 0 14px; }
h2 { color: #1E4D47; font-size: 13pt; border-bottom: 1px solid #C5D0CB; padding-bottom: 4px; margin-top: 22px; }
code { font-size: 9.5pt; background: #E6ECE8; padding: 0 3px; }
table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #C5D0CB; padding: 5px 6px; text-align: left; }
a { color: #1E4D47; }
CSS
pandoc -f gfm "$ROOT/docs/COVERING_NOTE.md" -s --metadata title="FINN covering note" --css "$CSS" -o "$OUT/.note.html"
python3 - "$OUT/.note.html" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'<header id="title-block-header">.*?</header>', '', s, flags=re.S)
s = s.replace('</head>', '<link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@700&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet"></head>')
open(p, 'w').write(s)
PY
CHROME="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium)"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=5000 \
  --print-to-pdf="$OUT/FINN-covering-note-$VERSION.pdf" "file://$OUT/.note.html" 2>/dev/null
rm -f "$OUT/.note.html" "$CSS"

echo "==> tag + release"
git -C "$ROOT" tag -a "$TAG" -m "FINN $TAG: $SUMMARY"
git -C "$ROOT" push -q origin HEAD "$TAG"
gh release create "$TAG" "$OUT/FINN-$VERSION.apk" "$OUT/FINN-covering-note-$VERSION.pdf" \
  --repo "$(git -C "$ROOT" remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')" \
  --title "FINN $TAG" --notes "$SUMMARY

Install: download FINN-$VERSION.apk on an Android phone and open it.
Covering note: FINN-covering-note-$VERSION.pdf"
echo "released $TAG"
