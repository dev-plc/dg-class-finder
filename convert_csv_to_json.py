import csv
import json
import re

# Location별 이미지 매핑
location_images = {
    '웨슬리홀': 'images/1130_웨슬리홀.jpg',
    '칼빈채플': 'images/1130_칼빈.jpg',
    '자모영아실': 'images/자모 영아실 안내.jpg'
}

members = []
skipped = []

csv_filename = '출석부작업_251125+ - 일반출석부_5주차작업용_출력 (2).csv'

print(f'📂 읽는 중: {csv_filename}')

with open(csv_filename, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    
    for row_num, row in enumerate(reader, start=2):  # CSV는 1행이 헤더, 2행부터 데이터
        location = row.get('Location', '').strip()
        team = row.get('Team', '').strip()
        id_field = row.get('ID', '').strip()
        
        # 빈 행 스킵
        if not location or not team or not id_field:
            continue
        
        # NOTE가 숫자만 있는 줄은 합계/구분선이므로 스킵
        note = row.get('NOTE', '').strip()
        if note and re.match(r'^\d+$', note):
            continue
        
        # ID 필드에서 이름과 전화번호 분리
        # 예: "이민재6550 서브튜터" -> 이름: "이민재", 전화번호: "6550"
        # 예: "이회백" -> 전화번호 없음 (스킵)
        match = re.search(r'([가-힣a-zA-Z]+)(\d{4})', id_field)
        
        if match:
            name = match.group(1)
            phone = match.group(2)
            
            # Location에 맞는 이미지 선택
            map_image = location_images.get(location, 'images/1130_칼빈.jpg')
            
            member = {
                "location": location,
                "team": team,
                "name": name,
                "phone": phone,
                "age": 0,  # 나이는 기본값 0
                "mapImage": map_image
            }
            
            members.append(member)
        else:
            # 전화번호가 없는 경우 (예: "이회백")
            skipped.append(f"  - {row_num}번 줄: {id_field} (전화번호 4자리 없음)")

# data.json으로 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(members, f, ensure_ascii=False, indent=2)

print(f'\n✅ 총 {len(members)}명의 데이터가 data.json에 저장되었습니다!')
print(f'\n📍 위치별:')
print(f'   - 웨슬리홀: {sum(1 for m in members if m["location"] == "웨슬리홀")}명')
print(f'   - 칼빈채플: {sum(1 for m in members if m["location"] == "칼빈채플")}명')
print(f'   - 자모영아실: {sum(1 for m in members if m["location"] == "자모영아실")}명')

if skipped:
    print(f'\n⚠️  처리되지 않은 항목 ({len(skipped)}개):')
    for item in skipped[:10]:  # 최대 10개만 표시
        print(item)
    if len(skipped) > 10:
        print(f'  ... 외 {len(skipped) - 10}개')

