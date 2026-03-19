import json

# 이미지 경로 업데이트 매핑
image_path_mapping = {
    'images/1116_웨슬리.jpg': 'images/1122_웨슬리홀.jpg',
    'images/1116_칼빈.jpg': 'images/1122_칼빈.jpg'
}

# data.json 파일 읽기
with open('data.json', 'r', encoding='utf-8') as f:
    members = json.load(f)

# 이미지 경로 업데이트
updated_count = 0
for member in members:
    old_path = member.get('mapImage', '')
    if old_path in image_path_mapping:
        member['mapImage'] = image_path_mapping[old_path]
        updated_count += 1

# 업데이트된 데이터 저장
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(members, f, ensure_ascii=False, indent=2)

print(f'✅ 이미지 경로 업데이트 완료!')
print(f'   - 총 {len(members)}명 중 {updated_count}명의 이미지 경로가 업데이트되었습니다.')
print(f'\n📋 업데이트 내용:')
print(f'   - images/1116_웨슬리.jpg → images/1122_웨슬리홀.jpg')
print(f'   - images/1116_칼빈.jpg → images/1122_칼빈.jpg')
print(f'\n📍 위치별 통계:')
location_stats = {}
for member in members:
    location = member.get('location', '')
    image_path = member.get('mapImage', '')
    if location not in location_stats:
        location_stats[location] = {}
    if image_path not in location_stats[location]:
        location_stats[location][image_path] = 0
    location_stats[location][image_path] += 1

for location, images in sorted(location_stats.items()):
    print(f'   - {location}:')
    for image_path, count in sorted(images.items()):
        print(f'     * {image_path}: {count}명')

