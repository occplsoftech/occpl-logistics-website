#!/usr/bin/env bash
# Deploy now, for the GitHub Action that runs on every merge to main (.github/workflows/deploy.yml).
# Installed as ~/occpl-website-auto/hook-deploy.sh and run only as the forced command of the Action's own SSH key
# (command="...",restrict in ~/.ssh/authorized_keys), so that key can do nothing else. It takes no input.
# It runs the same auto-deploy.sh as cron, then reports whether main is live. Exit 1 when the deploy failed.
set -uo pipefail
BASE=$HOME/occpl-website-auto
REPO=https://github.com/occplsoftech/occpl-logistics-website.git
export PATH=/usr/local/bin:/usr/bin:/bin
cd "$BASE" || exit 1

for attempt in 1 2 3; do
  flock -w 900 .lock true || { echo "another deploy is still running"; exit 1; }   # wait for a cron run to finish
  "$BASE/auto-deploy.sh" >> deploy.log 2>&1
  sha=$(git ls-remote "$REPO" refs/heads/main | cut -f1)
  if [ "$sha" = "$(cat deployed 2>/dev/null)" ]; then
    grep -F "$sha" deploy.log | tail -2
    echo "live: $sha"
    exit 0
  fi
  if [ "$sha" = "$(cat failed 2>/dev/null)" ]; then
    tail -3 deploy.log
    echo "deploy of $sha failed; the site still runs the last good version"
    exit 1
  fi
  sleep 5
done
tail -3 deploy.log
echo "not live yet; the 2-minute cron check keeps trying"
exit 1
