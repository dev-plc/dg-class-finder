import csv
import json
import re
import os
import sys
import glob

# 작업 디렉토리를 스크립트가 있는 디렉토리로 변경
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

# CSV 파일명 결정
# 1. 명령줄 인자로 파일명이 제공되면 사용
# 2. 그렇지 않으면 "출석부작업"으로 시작하는 가장 최신 CSV 파일 사용
if len(sys.argv) > 1:
    csv_filename = sys.argv[1]
else:
    # "출석부작업"으로 시작하는 모든 CSV 파일 찾기
    csv_files = glob.glob('출석부작업*.csv')
    if csv_files:
        # 수정 시간 기준으로 가장 최신 파일 선택
        csv_filename = max(csv_files, key=os.path.getmtime)
        print(f'📁 자동으로 선택된 파일: {csv_filename}')
    else:
        print('❌ CSV 파일을 찾을 수 없습니다.')
        print('   사용법: python convert_csv_4week.py [파일명.csv]')
        sys.exit(1)

# images 폴더에서 실제 이미지 파일 찾기
def find_latest_image(location_keyword):
    """주어진 키워드로 images 폴더에서 가장 최신 이미지 파일 찾기"""
    images_dir = 'images'
    if not os.path.exists(images_dir):
        return None
    
    # 키워드에 맞는 이미지 파일 찾기
    pattern = os.path.join(images_dir, f'*{location_keyword}*.jpg')
    matching_files = glob.glob(pattern)
    
    if matching_files:
        # 가장 최신 파일 반환
        latest_file = max(matching_files, key=os.path.getmtime)
        return latest_file
    return None

# Location별 이미지 자동 매핑
location_images = {}
location_keywords = {
    '웨슬리홀': '웨슬리홀',
    '칼빈채플': '칼빈',
    '자모영아실': '자모'
}

print('🔍 이미지 파일 검색 중...')
for location, keyword in location_keywords.items():
    image_path = find_latest_image(keyword)
    if image_path:
        location_images[location] = image_path
        print(f'   ✅ {location}: {image_path}')
    else:
        # 기본 이미지 (없을 경우)
        location_images[location] = f'images/{keyword}.jpg'
        print(f'   ⚠️  {location}: 이미지를 찾을 수 없음 (기본값: {location_images[location]})')

print()

members = []
skipped_count = 0

with open(csv_filename, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    
    for row_num, row in enumerate(reader, 1):
        # 빈 행 스킵 (location과 id_field만 체크, team은 선택사항)
        if len(row) < 3 or not row[0] or not row[2]:
            continue
        
        location = row[0].strip()
        team = row[1].strip() if len(row) > 1 else ''
        id_field = row[2].strip()
        age_str = row[3].strip() if len(row) > 3 else ''
        
        # 빈 값 스킵 (location과 id_field만 필수, team은 선택사항)
        if not location or not id_field:
            continue
        
        # 팀이 비어있으면 경고 메시지
        if not team:
            print(f'⚠️  {row_num}번째 줄: 팀 정보 없음 (빈 팀으로 저장됨) - {id_field}')
        
        # ID 필드에서 이름과 전화번호 분리
        # 예: "송유미2205" -> 이름: "송유미", 전화번호: "2205"
        # 예: "이민재6550 서브튜터" -> 이름: "이민재", 전화번호: "6550" (서브튜터 제거)
        # 먼저 공백이나 특수문자로 분리된 부분 제거
        id_field_clean = id_field.split()[0] if ' ' in id_field else id_field
        match = re.search(r'([가-힣a-zA-Z]+)(\d{4})', id_field_clean)
        
        if match:
            name = match.group(1)
            phone = match.group(2)
        else:
            # 전화번호가 없는 경우: 이름만 추출하고 임시 전화번호 부여
            name_match = re.search(r'([가-힣a-zA-Z]+)', id_field_clean)
            if name_match:
                name = name_match.group(1)
                phone = "0000"  # 임시 전화번호 (관리자 모드에서만 검색 가능)
                print(f'⚠️  {row_num}번째 줄: {name} (전화번호 없음 → 임시번호 0000 부여)')
            else:
                skipped_count += 1
                print(f'❌ {row_num}번째 줄 스킵: {id_field} (이름 추출 실패)')
                continue
        
        # 나이 처리 (빈 값이면 0)
        age = int(age_str) if age_str and age_str.isdigit() else 0
        
        # Location에 맞는 이미지 선택
        map_image = location_images.get(location, 'images/1214_칼빈.jpg')
        
        member = {
            "location": location,
            "team": team,
            "name": name,
            "phone": phone,
            "age": age,
            "mapImage": map_image
        }
        
        members.append(member)

# data.json으로 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(members, f, ensure_ascii=False, indent=2)

print(f'\n✅ 총 {len(members)}명의 데이터가 data.json에 저장되었습니다!')
print(f'   - 웨슬리홀: {sum(1 for m in members if m["location"] == "웨슬리홀")}명')
print(f'   - 칼빈채플: {sum(1 for m in members if m["location"] == "칼빈채플")}명')
print(f'   - 자모영아실: {sum(1 for m in members if m["location"] == "자모영아실")}명')

print(f'\n📊 나이 통계:')
print(f'   - 60세 이상: {sum(1 for m in members if m["age"] >= 60)}명')
print(f'   - 50-59세: {sum(1 for m in members if 50 <= m["age"] < 60)}명')
print(f'   - 50세 미만: {sum(1 for m in members if 0 < m["age"] < 50)}명')
print(f'   - 나이 미입력: {sum(1 for m in members if m["age"] == 0)}명')

# 이미지 경로 확인
print(f'\n🖼️  이미지 경로 확인:')
for location, image_path in location_images.items():
    count = sum(1 for m in members if m["location"] == location)
    if count > 0:
        exists = os.path.exists(image_path)
        status = '✅' if exists else '❌'
        print(f'   {status} {location}: {image_path} ({count}명)')
        if not exists:
            print(f'      ⚠️  파일이 존재하지 않습니다!')

# 실제 사용된 이미지 경로 통계
print(f'\n📸 실제 할당된 이미지:')
image_usage = {}
for member in members:
    img = member['mapImage']
    if img in image_usage:
        image_usage[img] += 1
    else:
        image_usage[img] = 1

for img_path, count in sorted(image_usage.items()):
    exists = os.path.exists(img_path)
    status = '✅' if exists else '❌'
    print(f'   {status} {img_path}: {count}명')

if skipped_count > 0:
    print(f'\n⚠️  스킵된 항목: {skipped_count}개 (전화번호 없음)')
