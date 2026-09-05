#!/usr/bin/env bash
# sync_repo_md_to_github_kb.sh
#
# GitHub Actions 안에서 실행됩니다. 현재 저장소의 모든 .md 파일에 프론트매터를
# 붙여 dev-plc/knowledge-base 저장소의 <이 저장소명>/<경로> 위치로 미러링합니다.
#
# knowledge-base 가 옵시디언 볼트의 원천입니다 — 데스크톱이 그 저장소를
# G:\내 드라이브\EleaZar\dev-notes\ 로 fetch + reset 해서 받아갑니다.
# 예전에는 여기서 Google Drive API 로 직접 올렸지만, 그 경로가 요구하는
# auth/drive 는 Google 이 '제한된(restricted) 스코프' 로 분류합니다. 그런 앱을
# 프로덕션으로 게시하려면 제3자 보안 평가(CASA)를 통과해야 하고, 테스트 상태에
# 머무는 한 리프레시 토큰이 7일마다 강제 만료됩니다(invalid_grant). 고칠 수 있는
# 종류가 아니어서 Drive API 를 걷어내고 git 경로로 일원화했습니다.
#
# 필요 환경변수:
#   GH_TOKEN   knowledge-base 저장소에 쓰기 권한이 있는 PAT (gh CLI가 자동 사용)
#   KB_REPO    미러링 대상 저장소, 예: dev-plc/knowledge-base

set -euo pipefail

KB_REPO="${KB_REPO:?KB_REPO 환경변수가 필요합니다}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY 환경변수가 필요합니다}"
REPO_NAME="${GITHUB_REPOSITORY#*/}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

default_branch=$(gh api "repos/$KB_REPO" --jq '.default_branch')

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
failures="$workdir/failures"
: > "$failures"

remote_sha_of() {
  gh api "repos/$KB_REPO/contents/$1?ref=$default_branch" --jq '.sha' 2>/dev/null || echo ""
}

# 409 는 다른 실행이 같은 파일을 방금 바꿔 sha 가 어긋난 것입니다. 브랜치 필터와
# concurrency 로 동시 실행은 막았지만, 남은 경합에 대비해 sha 를 다시 읽고 재시도합니다.
put_file() {
  local target_path="$1" content_b64="$2" sha="$3"
  local attempt
  for attempt in 1 2 3; do
    local -a args=(
      --method PUT "repos/$KB_REPO/contents/$target_path"
      -f message="sync: $target_path"
      -f content="$content_b64"
      -f branch="$default_branch"
    )
    if [ -n "$sha" ]; then
      args+=(-f sha="$sha")
    fi

    if gh api "${args[@]}" >/dev/null 2>"$workdir/err"; then
      return 0
    fi

    if grep -qE 'HTTP 409|409 Conflict' "$workdir/err"; then
      sha=$(remote_sha_of "$target_path")
      sleep $((attempt * 2))
      continue
    fi

    cat "$workdir/err" >&2
    return 1
  done

  echo "  409 재시도 3회 실패: $target_path" >&2
  return 1
}

created=0
updated=0
skipped=0

# find 를 파이프로 while 에 물리면 서브셸이라 카운터가 안 남습니다. 프로세스
# 치환으로 현재 셸에서 돌립니다.
while IFS= read -r -d '' filepath; do
  rel_path="${filepath#./}"
  target_path="$REPO_NAME/$rel_path"
  staged="$workdir/staged.md"

  if ! python3 "$SCRIPT_DIR/md_frontmatter.py" "$rel_path" > "$staged"; then
    echo "  [실패] 프론트매터 생성: $rel_path" >&2
    echo "$target_path (프론트매터 생성)" >> "$failures"
    continue
  fi

  # Contents API 가 돌려주는 .sha 는 곧 git blob SHA 입니다. 올릴 내용의 해시와
  # 같으면 올려도 달라질 것이 없습니다 — 그런데도 PUT 하면 GitHub 은 트리가
  # 그대로인 빈 커밋을 만듭니다(예전 이력의 70%가 그것이었습니다).
  # --no-filters: .gitattributes 의 줄바꿈 변환에 해시가 흔들리지 않게.
  local_sha=$(git hash-object --no-filters "$staged")
  remote_sha=$(remote_sha_of "$target_path")

  if [ "$local_sha" = "$remote_sha" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  content_b64=$(base64 -w 0 "$staged")

  # 한 파일이 실패해도 나머지는 계속 올립니다. 예전에는 set -e 가 루프를 통째로
  # 끊어서, 09-03 에 12개 중 5개만 올라가고 나머지가 통째로 누락됐습니다.
  if put_file "$target_path" "$content_b64" "$remote_sha"; then
    if [ -n "$remote_sha" ]; then
      echo "  [knowledge-base] 업데이트: $target_path"
      updated=$((updated + 1))
    else
      echo "  [knowledge-base] 생성: $target_path"
      created=$((created + 1))
    fi
  else
    echo "  [실패] $target_path" >&2
    echo "$target_path" >> "$failures"
  fi
done < <(
  find . -name "*.md" \
    -not -path "./.git/*" \
    -not -path "*/node_modules/*" \
    -not -path "*/vendor/*" \
    -not -path "*/.venv/*" \
    -not -path "*/venv/*" \
    -not -path "*/dist/*" \
    -not -path "*/build/*" \
    -not -path "*/.github/*" \
    -print0
)

echo "knowledge-base 미러링 완료 — 생성 $created · 업데이트 $updated · 건너뜀 $skipped"

if [ -s "$failures" ]; then
  echo "::error::knowledge-base 미러링 중 $(wc -l < "$failures" | tr -d " ")건 실패 (아래 목록)"
  sed "s/^/  - /" "$failures"
  exit 1
fi
