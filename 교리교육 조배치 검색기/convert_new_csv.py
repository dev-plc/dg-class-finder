import csv
import json
import re

# Location별 이미지 매핑
location_images = {
    '웨슬리홀': 'images/1107_웨슬리.jpg',
    '칼빈채플': 'images/1107_칼빈.jpg',
    '자모영아실': 'images/자모 영아실 안내.jpg'
}

members = []

with open('교리교육 출석부_251109 - 1109_admin.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    
    for row in reader:
        location = row['Location'].strip()
        team = row['Team'].strip()
        id_field = row['ID'].strip()
        
        # 빈 행 스킵
        if not location or not team or not id_field:
            continue
        
        # ID 필드에서 이름과 전화번호 분리
        # 예: "이민재6550 서브튜터" -> 이름: "이민재", 전화번호: "6550"
        # 예: "c" -> 스킵 (잘못된 데이터)
        
        # 숫자 4자리를 찾기
        match = re.search(r'([가-힣a-zA-Z]+)(\d{4})', id_field)
        
        if match:
            name = match.group(1)
            phone = match.group(2)
            
            # Location에 맞는 이미지 선택
            map_image = location_images.get(location, 'images/1107_칼빈.jpg')
            
            member = {
                "location": location,
                "team": team,
                "name": name,
                "phone": phone,
                "mapImage": map_image
            }
            
            members.append(member)

# data.json으로 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(members, f, ensure_ascii=False, indent=2)

print(f'✅ 총 {len(members)}명의 데이터가 data.json에 저장되었습니다!')
print(f'   - 웨슬리홀: {sum(1 for m in members if m["location"] == "웨슬리홀")}명')
print(f'   - 칼빈채플: {sum(1 for m in members if m["location"] == "칼빈채플")}명')
print(f'   - 자모영아실: {sum(1 for m in members if m["location"] == "자모영아실")}명')

