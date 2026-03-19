#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import shutil

# 현재 디렉토리의 1116 이미지 파일들을 images 폴더로 이동
files_to_move = ['1116_웨슬리.jpg', '1116_칼빈.jpg']

for filename in files_to_move:
    if os.path.exists(filename):
        dest = os.path.join('images', filename)
        shutil.move(filename, dest)
        print(f"✅ {filename} → images/{filename}")
    else:
        print(f"❌ {filename} 파일을 찾을 수 없습니다.")

print("\n이미지 파일 이동 완료!")

