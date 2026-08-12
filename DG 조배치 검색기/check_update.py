import csv
import json
import re
from collections import defaultdict

print("=" * 60)
print("📊 data.json 업데이트 검수")
print("=" * 60)

# CSV 파일 읽기
csv_members = []
csv_skipped = []

with open('출석부작업_251122 - admin_4주차.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    for row_num, row in enumerate(reader, 1):
        if len(row) < 3 or not row[0] or not row[1] or not row[2]:
            continue
        
        location = row[0].strip()
        team = row[1].strip()
        id_field = row[2].strip()
        age_str = row[3].strip() if len(row) > 3 else ''
        
        if not location or not team or not id_field:
            continue
        
        match = re.search(r'([가-힣a-zA-Z]+)(\d{4})', id_field)
        if match:
            name = match.group(1)
            phone = match.group(2)
            age = int(age_str) if age_str and age_str.isdigit() else 0
            csv_members.append({
                'location': location,
                'team': team,
                'name': name,
                'phone': phone,
                'age': age
            })
        else:
            csv_skipped.append((row_num, id_field))

# JSON 파일 읽기
with open('data.json', 'r', encoding='utf-8') as f:
    json_members = json.load(f)

print(f"\n📋 CSV 파일 분석:")
print(f"   - 총 유효한 데이터: {len(csv_members)}명")
print(f"   - 스킵된 항목: {len(csv_skipped)}개")
if csv_skipped:
    print(f"   - 스킵된 항목 목록:")
    for row_num, id_field in csv_skipped:
        print(f"     * {row_num}번째 줄: {id_field}")

print(f"\n📋 JSON 파일 분석:")
print(f"   - 총 데이터: {len(json_members)}명")

# 위치별 통계 비교
print(f"\n📍 위치별 인원 수 비교:")
csv_by_location = defaultdict(int)
json_by_location = defaultdict(int)

for m in csv_members:
    csv_by_location[m['location']] += 1

for m in json_members:
    json_by_location[m['location']] += 1

locations = set(list(csv_by_location.keys()) + list(json_by_location.keys()))
for loc in sorted(locations):
    csv_count = csv_by_location.get(loc, 0)
    json_count = json_by_location.get(loc, 0)
    status = "✅" if csv_count == json_count else "❌"
    print(f"   {status} {loc}: CSV={csv_count}명, JSON={json_count}명")

# 조별 통계 비교
print(f"\n👥 조별 인원 수 비교 (상위 10개):")
csv_by_team = defaultdict(int)
json_by_team = defaultdict(int)

for m in csv_members:
    csv_by_team[m['team']] += 1

for m in json_members:
    json_by_team[m['team']] += 1

# 차이가 있는 조만 표시
diff_teams = []
for team in set(list(csv_by_team.keys()) + list(json_by_team.keys())):
    csv_count = csv_by_team.get(team, 0)
    json_count = json_by_team.get(team, 0)
    if csv_count != json_count:
        diff_teams.append((team, csv_count, json_count))

if diff_teams:
    print("   ⚠️  차이가 있는 조:")
    for team, csv_count, json_count in sorted(diff_teams)[:10]:
        print(f"      - {team}: CSV={csv_count}명, JSON={json_count}명")
else:
    print("   ✅ 모든 조의 인원 수가 일치합니다!")

# 나이 통계 비교
print(f"\n🎂 나이 통계 비교:")
csv_age_stats = {
    '60세 이상': sum(1 for m in csv_members if m['age'] >= 60),
    '50-59세': sum(1 for m in csv_members if 50 <= m['age'] < 60),
    '50세 미만': sum(1 for m in csv_members if 0 < m['age'] < 50),
    '나이 미입력': sum(1 for m in csv_members if m['age'] == 0)
}

json_age_stats = {
    '60세 이상': sum(1 for m in json_members if m['age'] >= 60),
    '50-59세': sum(1 for m in json_members if 50 <= m['age'] < 60),
    '50세 미만': sum(1 for m in json_members if 0 < m['age'] < 50),
    '나이 미입력': sum(1 for m in json_members if m['age'] == 0)
}

for age_group in csv_age_stats.keys():
    csv_count = csv_age_stats[age_group]
    json_count = json_age_stats[age_group]
    status = "✅" if csv_count == json_count else "❌"
    print(f"   {status} {age_group}: CSV={csv_count}명, JSON={json_count}명")

# 이름+전화번호로 매칭 확인
print(f"\n🔍 데이터 매칭 확인:")
csv_keys = {(m['name'], m['phone']) for m in csv_members}
json_keys = {(m['name'], m['phone']) for m in json_members}

only_in_csv = csv_keys - json_keys
only_in_json = json_keys - csv_keys

if only_in_csv:
    print(f"   ⚠️  CSV에만 있는 항목: {len(only_in_csv)}개")
    for name, phone in sorted(list(only_in_csv))[:5]:
        print(f"      - {name}{phone}")
    if len(only_in_csv) > 5:
        print(f"      ... 외 {len(only_in_csv) - 5}개")

if only_in_json:
    print(f"   ⚠️  JSON에만 있는 항목: {len(only_in_json)}개")
    for name, phone in sorted(list(only_in_json))[:5]:
        print(f"      - {name}{phone}")
    if len(only_in_json) > 5:
        print(f"      ... 외 {len(only_in_json) - 5}개")

if not only_in_csv and not only_in_json:
    print("   ✅ CSV와 JSON의 데이터가 완전히 일치합니다!")

# 최종 결과
print(f"\n{'=' * 60}")
if len(csv_members) == len(json_members) and not only_in_csv and not only_in_json:
    print("✅ 검수 결과: 업데이트가 정상적으로 완료되었습니다!")
else:
    print("⚠️  검수 결과: 일부 차이가 발견되었습니다. 위 내용을 확인해주세요.")
print(f"{'=' * 60}\n")

