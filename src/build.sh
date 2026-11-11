#!/usr/bin/env bash
# Build infallyn.html from the src/ modules.
# Order matters: head → css → body → core → auth → ui1 → ui2 → tail
set -e
cd "$(dirname "$0")"
cat core.js auth.js ui1.js ui2.js > .combined.js
node --check .combined.js   # syntax gate (requires Node; skip if unavailable)
cat head.html app.css body.html .combined.js tail.html > ../index.html
rm .combined.js
echo "Built ../index.html ($(wc -c < ../index.html) bytes)"
