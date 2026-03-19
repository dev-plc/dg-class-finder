import json

# data.json 읽기
with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Location별 새로운 이미지 매핑
location_images = {
    '웨슬리홀': 'images/1107_웨슬리.jpg',
    '칼빈 채플': 'images/1107_칼빈.jpg',
    '자모 영아실': 'images/자모 영아실 안내.jpg'
}

# 각 성도에게 Location에 맞는 이미지 설정
updated = 0
for member in data:
    location = member.get('location', '')
    if location in location_images:
        member['mapImage'] = location_images[location]
        updated += 1

# 수정된 data.json 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'✅ {updated}명의 성도 데이터에 새로운 배치도 이미지가 업데이트되었습니다.')
print(f'   - 웨슬리홀 → 1107_웨슬리.jpg')
print(f'   - 칼빈 채플 → 1107_칼빈.jpg')
print(f'   - 자모 영아실 → 자모 영아실 안내.jpg')

