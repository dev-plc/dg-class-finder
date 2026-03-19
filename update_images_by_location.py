import json

# data.json 읽기
with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Location별 이미지 매핑
location_images = {
    '웨슬리홀': 'images/웨슬리홀.jpg',
    '칼빈 채플': 'images/칼빈채플.jpg',
    '자모 영아실': 'images/자모 영아실 안내.jpg'  # 안내 이미지
}

# 각 성도에게 Location에 맞는 이미지 설정
updated = 0
for member in data:
    location = member.get('location', '')
    if location in location_images:
        member['mapImage'] = location_images[location]
        updated += 1
    else:
        # 알 수 없는 location은 기본 이미지
        member['mapImage'] = 'images/1102 배치도.jpg'

# 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'✅ 완료!')
print(f'📊 총 {len(data)}명의 배치도 이미지를 업데이트했습니다.')
print(f'\n📍 Location별 현황:')

# 통계
from collections import Counter
locations = [m['location'] for m in data]
for loc, count in Counter(locations).items():
    img = location_images.get(loc, '기본 이미지')
    print(f'  - {loc}: {count}명 → {img}')

