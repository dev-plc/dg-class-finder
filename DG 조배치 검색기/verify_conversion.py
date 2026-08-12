import csv
import json
import re
import os

# CSV 파일명
csv_filename = '출석부작업_251202+ - admin_6주차 (1).csv'
json_filename = 'data.json'

print('=' * 60)
print('CSV ↔ JSON 변환 검증 스크립트')
print('=' * 60)

# CSV에서 데이터 추출
csv_data = []
skipped_rows = []

with open(csv_filename, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    
    for row_num, row in enumerate(reader, 1):
        # 빈 행 스킵
        if len(row) < 3 or not row[0] or not row[2]:
            if len(row) > 0 and any(cell.strip() for cell in row):
                skipped_rows.append((row_num, row))
            continue
        
        location = row[0].strip()
        team = row[1].strip() if len(row) > 1 else ''
        id_field = row[2].strip()
        age_str = row[3].strip() if len(row) > 3 else ''
        
        # location과 id_field만 필수
        if not location or not id_field:
            skipped_rows.append((row_num, row))
            continue
        
        # 이름과 전화번호 추출
        id_field_clean = id_field.split()[0] if ' ' in id_field else id_field
        match = re.search(r'([가-힣a-zA-Z]+)(\d{4})', id_field_clean)
        
        if match:
            name = match.group(1)
            phone = match.group(2)
        else:
            # 전화번호가 없는 경우
            name_match = re.search(r'([가-힣a-zA-Z]+)', id_field_clean)
            if name_match:
                name = name_match.group(1)
                phone = "0000"
            else:
                skipped_rows.append((row_num, row))
                continue
        
        age = int(age_str) if age_str and age_str.isdigit() else 0
        
        csv_data.append({
            'row': row_num,
            'location': location,
            'team': team,
            'name': name,
            'phone': phone,
            'age': age
        })

# JSON에서 데이터 읽기
with open(json_filename, 'r', encoding='utf-8') as f:
    json_data = json.load(f)

# JSON 데이터를 딕셔너리로 변환 (이름+전화번호를 키로)
json_dict = {}
for item in json_data:
    key = f"{item['name']}|{item['phone']}"
    json_dict[key] = item

# CSV 데이터를 딕셔너리로 변환
csv_dict = {}
for item in csv_data:
    key = f"{item['name']}|{item['phone']}"
    csv_dict[key] = item

# 비교 분석
print(f'\n📊 데이터 통계:')
print(f'   CSV 파일: {len(csv_data)}명 (유효한 데이터)')
print(f'   JSON 파일: {len(json_data)}명')
print(f'   스킵된 CSV 행: {len(skipped_rows)}개')

# 누락된 데이터 찾기 (CSV에는 있지만 JSON에는 없음)
missing_in_json = []
for key, csv_item in csv_dict.items():
    if key not in json_dict:
        missing_in_json.append(csv_item)

# 추가된 데이터 찾기 (JSON에는 있지만 CSV에는 없음)
extra_in_json = []
for key, json_item in json_dict.items():
    if key not in csv_dict:
        extra_in_json.append(json_item)

# 불일치하는 데이터 찾기 (이름+전화번호는 같지만 다른 정보가 다름)
mismatches = []
for key in csv_dict:
    if key in json_dict:
        csv_item = csv_dict[key]
        json_item = json_dict[key]
        
        differences = []
        if csv_item['location'] != json_item['location']:
            differences.append(f"위치: CSV={csv_item['location']}, JSON={json_item['location']}")
        if csv_item['team'] != json_item['team']:
            differences.append(f"팀: CSV={csv_item['team']}, JSON={json_item['team']}")
        if csv_item['age'] != json_item['age']:
            differences.append(f"나이: CSV={csv_item['age']}, JSON={json_item['age']}")
        
        if differences:
            mismatches.append({
                'name': csv_item['name'],
                'phone': csv_item['phone'],
                'row': csv_item['row'],
                'differences': differences
            })

# 결과 출력
print('\n' + '=' * 60)
print('검증 결과')
print('=' * 60)

if missing_in_json:
    print(f'\n❌ JSON에 누락된 데이터 ({len(missing_in_json)}명):')
    for item in missing_in_json[:20]:  # 최대 20개만 표시
        print(f'   {item["row"]}번째 줄: {item["name"]} ({item["phone"]}) - {item["location"]}, {item["team"]}')
    if len(missing_in_json) > 20:
        print(f'   ... 외 {len(missing_in_json) - 20}명 더')
else:
    print('\n✅ JSON에 누락된 데이터 없음')

if extra_in_json:
    print(f'\n⚠️  JSON에만 있는 데이터 ({len(extra_in_json)}명):')
    for item in extra_in_json[:20]:  # 최대 20개만 표시
        print(f'   {item["name"]} ({item["phone"]}) - {item["location"]}, {item["team"]}')
    if len(extra_in_json) > 20:
        print(f'   ... 외 {len(extra_in_json) - 20}명 더')
else:
    print('\n✅ JSON에만 있는 데이터 없음')

if mismatches:
    print(f'\n⚠️  데이터 불일치 ({len(mismatches)}명):')
    for item in mismatches[:20]:  # 최대 20개만 표시
        print(f'   {item["row"]}번째 줄: {item["name"]} ({item["phone"]})')
        for diff in item['differences']:
            print(f'      - {diff}')
    if len(mismatches) > 20:
        print(f'   ... 외 {len(mismatches) - 20}명 더')
else:
    print('\n✅ 데이터 불일치 없음')

if skipped_rows:
    print(f'\n📝 CSV에서 스킵된 행 ({len(skipped_rows)}개):')
    for row_num, row in skipped_rows[:10]:  # 최대 10개만 표시
        print(f'   {row_num}번째 줄: {",".join(row)}')
    if len(skipped_rows) > 10:
        print(f'   ... 외 {len(skipped_rows) - 10}개 더')

# 최종 결과
print('\n' + '=' * 60)
if not missing_in_json and not mismatches:
    print('✅ 변환 검증 완료: 모든 데이터가 정상적으로 변환되었습니다!')
else:
    print('⚠️  변환 검증 완료: 일부 문제가 발견되었습니다.')
print('=' * 60)
