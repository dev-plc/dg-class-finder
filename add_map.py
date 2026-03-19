import json

with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for member in data:
    member['mapImage'] = 'images/1102 배치도.jpg'

with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'✅ 완료! 총 {len(data)}명에게 배치도 이미지를 추가했습니다.')

