import csv
import json
import re

# Location별 이미지 매핑
location_images = {
    '웨슬리홀': 'images/1107_웨슬리_v2.jpg',
    '칼빈채플': 'images/1107_칼빈.jpg',
    '자모영아실': 'images/자모 영아실 안내.jpg'
}

members = []

with open('교리교육 출석부_251109 - 1109_admin_add age.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    
    for row in reader:
        location = row['Location'].strip()
        team = row['Team'].strip()
        id_field = row['ID'].strip()
        age = row['Age'].strip()
        
        # 빈 행 스킵
        if not location or not team or not id_field:
            continue
        
        # ID 필드에서 이름과 전화번호 분리
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
                "age": int(age) if age else 0,  # 나이 추가
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
print(f'\n📊 50세 이상: {sum(1 for m in members if m["age"] >= 50)}명')
print(f'   50세 미만: {sum(1 for m in members if m["age"] < 50 and m["age"] > 0)}명')

