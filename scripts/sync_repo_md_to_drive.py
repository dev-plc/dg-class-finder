#!/usr/bin/env python3
"""
sync_repo_md_to_drive.py

GitHub Actions에서 실행되어, 현재 체크아웃된 저장소의 .md 파일들을
Google Drive의 지정된 폴더(옵시디언 볼트 하위)로 업로드합니다.

Drive 폴더 구조:
  <VAULT_FOLDER_ID>/
    dev-notes/                  <- SYNC_SUBFOLDER 값 (기본: "dev-notes")
      <repo-name>/
        <저장소 내 상대 경로 그대로 재현>
          파일.md

각 파일 상단에 아래와 같은 프론트매터를 자동으로 추가합니다 (기존에 프론트매터가
없는 파일에 한해서만; 이미 --- 로 시작하는 파일은 그대로 둡니다):

---
source_repo: owner/repo
source_path: docs/설계노트.md
github_url: https://github.com/owner/repo/blob/main/docs/설계노트.md
tags: [dev-notes, "repo:repo명"]
synced_at: 2026-08-27T12:00:00
---

필요 환경변수:
    GDRIVE_SA_KEY_JSON   서비스 계정 키(JSON) 전체 내용
    GDRIVE_VAULT_FOLDER_ID  옵시디언 볼트 내 동기화 대상 최상위 폴더의 Drive 폴더 ID
    GITHUB_REPOSITORY    "owner/repo" (GitHub Actions가 자동으로 넣어줌)
    GITHUB_SERVER_URL    "https://github.com" (GitHub Actions가 자동으로 넣어줌)
    GITHUB_REF_NAME      브랜치명 (GitHub Actions가 자동으로 넣어줌, 기본 main 가정)
    SYNC_SUBFOLDER       (선택) Drive 상 하위 폴더명, 기본값 "dev-notes"
    EXCLUDE_DIRS         (선택) 콤마로 구분된 제외 폴더명, 기본값 아래 DEFAULT_EXCLUDE_DIRS
"""

import os
import io
import fnmatch
from datetime import datetime, timezone

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

SCOPES = ["https://www.googleapis.com/auth/drive"]
DEFAULT_EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "vendor",
    ".venv",
    "venv",
    "dist",
    "build",
    ".github",
}


def get_env(name, default=None, required=False):
    val = os.environ.get(name, default)
    if required and not val:
        raise SystemExit(f"필수 환경변수 누락: {name}")
    return val


def build_drive_service():
    # 서비스 계정은 자체 저장 용량이 없어 개인 My Drive에는 업로드가 막히므로
    # (storageQuotaExceeded), 본인 Google 계정으로 인증하는 OAuth 리프레시 토큰 사용
    creds = Credentials(
        None,
        refresh_token=get_env("GDRIVE_OAUTH_REFRESH_TOKEN", required=True),
        client_id=get_env("GDRIVE_OAUTH_CLIENT_ID", required=True),
        client_secret=get_env("GDRIVE_OAUTH_CLIENT_SECRET", required=True),
        token_uri="https://oauth2.googleapis.com/token",
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return build("drive", "v3", credentials=creds)


def find_or_create_folder(service, name, parent_id):
    """parent_id 아래에서 이름이 name인 폴더를 찾고, 없으면 생성."""
    safe_name = name.replace("'", "\\'")
    query = (
        f"name = '{safe_name}' and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    resp = service.files().list(q=query, fields="files(id, name)").execute()
    files = resp.get("files", [])
    if files:
        return files[0]["id"]

    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def resolve_path_to_folder_id(service, root_folder_id, path_parts):
    """path_parts(폴더명 리스트)를 순서대로 만들며 최종 폴더 id를 반환."""
    current_id = root_folder_id
    for part in path_parts:
        current_id = find_or_create_folder(service, part, current_id)
    return current_id


def find_existing_file(service, filename, parent_id):
    safe_name = filename.replace("'", "\\'")
    query = f"name = '{safe_name}' and '{parent_id}' in parents and trashed = false"
    resp = service.files().list(q=query, fields="files(id, name)").execute()
    files = resp.get("files", [])
    return files[0]["id"] if files else None


def has_frontmatter(text: str) -> bool:
    return text.lstrip().startswith("---")


def build_frontmatter(repo_full_name, rel_path, repo_url, branch, repo_short_name):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    github_url = f"{repo_url}/blob/{branch}/{rel_path}"
    return (
        "---\n"
        f"source_repo: {repo_full_name}\n"
        f'source_path: "{rel_path}"\n'
        f"github_url: {github_url}\n"
        f'tags: [dev-notes, "repo:{repo_short_name}"]\n'
        f"synced_at: {now}\n"
        "---\n\n"
    )


def collect_markdown_files(root_dir, exclude_dirs):
    md_files = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
        for filename in filenames:
            if fnmatch.fnmatch(filename, "*.md"):
                full_path = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(full_path, root_dir)
                md_files.append(rel_path)
    return md_files


def upload_file(service, folder_id, filename, content_bytes):
    existing_id = find_existing_file(service, filename, folder_id)
    media = MediaIoBaseUpload(
        io.BytesIO(content_bytes), mimetype="text/markdown", resumable=False
    )
    if existing_id:
        service.files().update(fileId=existing_id, media_body=media).execute()
        return "updated"
    else:
        metadata = {"name": filename, "parents": [folder_id]}
        service.files().create(body=metadata, media_body=media).execute()
        return "created"


def main():
    vault_folder_id = get_env("GDRIVE_VAULT_FOLDER_ID", required=True)
    sync_subfolder = get_env("SYNC_SUBFOLDER", default="dev-notes")
    repo_full_name = get_env("GITHUB_REPOSITORY", required=True)  # owner/repo
    server_url = get_env("GITHUB_SERVER_URL", default="https://github.com")
    branch = get_env("GITHUB_REF_NAME", default="main")
    exclude_env = get_env("EXCLUDE_DIRS", default="")

    repo_short_name = repo_full_name.split("/")[-1]
    repo_url = f"{server_url}/{repo_full_name}"

    exclude_dirs = set(DEFAULT_EXCLUDE_DIRS)
    if exclude_env:
        exclude_dirs |= {d.strip() for d in exclude_env.split(",") if d.strip()}

    service = build_drive_service()

    # Drive 상 <VAULT>/<sync_subfolder>/<repo_short_name> 폴더 준비
    target_root_id = resolve_path_to_folder_id(
        service, vault_folder_id, [sync_subfolder, repo_short_name]
    )

    root_dir = os.getcwd()
    md_files = collect_markdown_files(root_dir, exclude_dirs)
    print(f"{repo_full_name}: {len(md_files)}개 마크다운 파일 발견")

    for rel_path in md_files:
        full_path = os.path.join(root_dir, rel_path)
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        if not has_frontmatter(content):
            content = (
                build_frontmatter(
                    repo_full_name, rel_path, repo_url, branch, repo_short_name
                )
                + content
            )

        # 저장소 내 하위 폴더 구조를 Drive에도 그대로 재현
        path_parts = rel_path.split(os.sep)
        filename = path_parts[-1]
        subfolders = path_parts[:-1]
        parent_id = resolve_path_to_folder_id(service, target_root_id, subfolders)

        action = upload_file(service, parent_id, filename, content.encode("utf-8"))
        print(f"  {action}: {rel_path}")

    print("완료.")


if __name__ == "__main__":
    main()
