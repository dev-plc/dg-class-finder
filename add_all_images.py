import json

# data.json 읽기
with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 모든 성도에게 배치도 이미지 추가
added = 0
for member in data:
    if 'mapImage' not in member:
        member['mapImage'] = 'images/1102 배치도.jpg'
        added += 1

# 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'✅ 완료!')
print(f'📊 총 {len(data)}명 중 {added}명에게 배치도 이미지를 추가했습니다.')
print(f'📸 이미 있던 사람: {len(data) - added}명')








