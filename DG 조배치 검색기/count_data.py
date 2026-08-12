import json

with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f'=== data.json 분석 ===')
print(f'총 데이터 개수: {len(data)}명')
print()

# 장소별 통계
locations = {}
for member in data:
    loc = member['location']
    locations[loc] = locations.get(loc, 0) + 1

print('장소별 인원:')
for loc, count in locations.items():
    print(f'  {loc}: {count}명')
print()

# 조별 통계
teams = {}
for member in data:
    team = member['team']
    teams[team] = teams.get(team, 0) + 1

print(f'총 조 개수: {len(teams)}개')
print()

# 중복 확인 (이름+전화번호)
duplicates = {}
for member in data:
    key = f"{member['name']}_{member['phone']}"
    if key in duplicates:
        duplicates[key].append(member)
    else:
        duplicates[key] = [member]

dup_count = sum(1 for v in duplicates.values() if len(v) > 1)
if dup_count > 0:
    print(f'⚠️ 중복 데이터 발견: {dup_count}건')
    for key, members in duplicates.items():
        if len(members) > 1:
            print(f'  - {key}: {len(members)}번 중복')
else:
    print('✅ 중복 데이터 없음')

