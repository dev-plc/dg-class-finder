import json

# data.json 읽기
with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 이미지 경로 업데이트
updated_count = 0
for member in data:
    if 'mapImage' in member:
        old_path = member['mapImage']
        new_path = old_path.replace('1122_', '1207_')
        if old_path != new_path:
            member['mapImage'] = new_path
            updated_count += 1

# 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'✅ {updated_count}개의 이미지 경로가 업데이트되었습니다!')
print(f'   1122_ → 1207_')
