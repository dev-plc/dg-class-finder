#!/usr/bin/env python3
"""
md_frontmatter.py <저장소 내 상대 경로>

파일에 옵시디언용 프론트매터를 붙여 표준 출력으로 냅니다. 이미 --- 로 시작하는
파일은 그대로 흘려보냅니다. sync_repo_md_to_github_kb.sh 가 파일마다 한 번씩 부릅니다.

표준 라이브러리만 씁니다 — 워크플로에 pip 설치 단계를 되살리지 않기 위해서입니다.

필요 환경변수 (GitHub Actions 가 자동으로 넣어줍니다):
    GITHUB_REPOSITORY   "owner/repo"
    GITHUB_SERVER_URL   "https://github.com"  (없으면 기본값)
    GITHUB_REF_NAME     브랜치명              (없으면 main)

⚠️ synced_at 은 일부러 넣지 않습니다. 매 실행마다 값이 바뀌면 내용이 그대로인
   파일도 계속 새 커밋을 만듭니다. 예전 Drive 스크립트가 그랬고, knowledge-base
   커밋의 70%(50개 중 35개)가 그렇게 생긴 빈 커밋이었습니다. 나머지 항목은
   파일 내용이나 경로가 바뀔 때만 바뀌므로 그대로 둡니다.
"""

import os
import sys


def has_frontmatter(text: str) -> bool:
    return text.lstrip().startswith("---")


def build_frontmatter(repo_full_name, rel_path, repo_url, branch, repo_short_name):
    github_url = f"{repo_url}/blob/{branch}/{rel_path}"
    return (
        "---\n"
        f"source_repo: {repo_full_name}\n"
        f'source_path: "{rel_path}"\n'
        f"github_url: {github_url}\n"
        f'tags: [dev-notes, "repo:{repo_short_name}"]\n'
        "---\n\n"
    )


def main():
    if len(sys.argv) != 2:
        raise SystemExit("사용법: md_frontmatter.py <저장소 내 상대 경로>")
    rel_path = sys.argv[1]

    repo_full_name = os.environ.get("GITHUB_REPOSITORY")
    if not repo_full_name:
        raise SystemExit("필수 환경변수 누락: GITHUB_REPOSITORY")
    server_url = os.environ.get("GITHUB_SERVER_URL") or "https://github.com"
    branch = os.environ.get("GITHUB_REF_NAME") or "main"
    repo_short_name = repo_full_name.split("/")[-1]

    with open(rel_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    if not has_frontmatter(content):
        content = (
            build_frontmatter(
                repo_full_name,
                rel_path,
                f"{server_url}/{repo_full_name}",
                branch,
                repo_short_name,
            )
            + content
        )

    # 해시가 실행마다 흔들리면 '무변경 건너뛰기' 가 무너진다. 인코딩과 줄바꿈을
    # 못 박아 러너 로캘에 좌우되지 않게 한다.
    sys.stdout.reconfigure(encoding="utf-8", newline="")
    sys.stdout.write(content)


if __name__ == "__main__":
    main()
