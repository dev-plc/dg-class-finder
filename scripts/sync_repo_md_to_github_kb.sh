#!/usr/bin/env bash
# sync_repo_md_to_github_kb.sh
#
# GitHub Actions 안에서 실행됩니다. 현재 저장소의 모든 .md 파일을
# dev-plc/knowledge-base 저장소의 <이 저장소명>/<경로> 위치로 미러링합니다.
#
# 필요 환경변수:
#   GH_TOKEN   knowledge-base 저장소에 쓰기 권한이 있는 PAT (gh CLI가 자동 사용)
#   KB_REPO    미러링 대상 저장소, 예: dev-plc/knowledge-base

set -e

KB_REPO="${KB_REPO:?KB_REPO 환경변수가 필요합니다}"
REPO_NAME="${GITHUB_REPOSITORY#*/}"

default_branch=$(gh api "repos/$KB_REPO" --jq '.default_branch')

find . -name "*.md" \
  -not -path "./.git/*" \
  -not -path "*/node_modules/*" \
  -not -path "*/vendor/*" \
  -not -path "*/.venv/*" \
  -not -path "*/venv/*" \
  -not -path "*/dist/*" \
  -not -path "*/build/*" \
  -not -path "*/.github/*" \
| while read -r filepath; do
    rel_path="${filepath#./}"
    target_path="$REPO_NAME/$rel_path"

    content_b64=$(base64 -w 0 "$filepath" 2>/dev/null || base64 "$filepath" | tr -d '\n')

    sha=$(gh api "repos/$KB_REPO/contents/$target_path?ref=$default_branch" --jq '.sha' 2>/dev/null || echo "")

    if [ -n "$sha" ]; then
      gh api --method PUT "repos/$KB_REPO/contents/$target_path" \
        -f message="sync: $target_path" \
        -f content="$content_b64" \
        -f sha="$sha" \
        -f branch="$default_branch" >/dev/null
      echo "  [knowledge-base] 업데이트: $target_path"
    else
      gh api --method PUT "repos/$KB_REPO/contents/$target_path" \
        -f message="sync: $target_path" \
        -f content="$content_b64" \
        -f branch="$default_branch" >/dev/null
      echo "  [knowledge-base] 생성: $target_path"
    fi
  done

echo "knowledge-base 미러링 완료."
