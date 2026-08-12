import csv
import json
import re
import os
import glob
from datetime import datetime

# Location별 이미지 매핑
location_images = {
    '웨슬리홀': 'images/1107_웨슬리_v2.jpg',
    '칼빈채플': 'images/1107_칼빈.jpg',
    '자모영아실': 'images/자모 영아실 안내.jpg'
}

def find_latest_csv():
    """가장 최신 CSV 파일 찾기"""
    csv_files = glob.glob('*.csv')
    if not csv_files:
        return None
    # 파일 수정 시간 기준으로 가장 최신 파일 반환
    return max(csv_files, key=os.path.getmtime)

def convert_csv_to_json(csv_filename):
    """CSV 파일을 JSON으로 변환"""
    members = []
    skipped = []
    
    print(f'📂 읽는 중: {csv_filename}')
    
    with open(csv_filename, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row_num, row in enumerate(reader, start=2):  # CSV는 1행이 헤더, 2행부터 데이터
            location = row.get('Location', '').strip()
            team = row.get('Team', '').strip()
            id_field = row.get('ID', '').strip()
            age = row.get('Age', '').strip() if 'Age' in row else ''
            
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
                    "mapImage": map_image
                }
                
                # Age 컬럼이 있으면 추가
                if age and age.isdigit():
                    member["age"] = int(age)
                else:
                    member["age"] = 0
                
                members.append(member)
            else:
                # 전화번호가 없는 경우
                skipped.append(f"  - {row_num}번 줄: {id_field} (전화번호 4자리 없음)")
    
    if skipped:
        print(f'\n⚠️  처리되지 않은 항목 ({len(skipped)}개):')
        for item in skipped[:10]:  # 최대 10개만 표시
            print(item)
        if len(skipped) > 10:
            print(f'  ... 외 {len(skipped) - 10}개')
    
    return members

def save_json(members, output_file='data.json'):
    """JSON 파일로 저장"""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

def print_statistics(members):
    """통계 출력"""
    print(f'\n✅ 총 {len(members)}명의 데이터가 data.json에 저장되었습니다!')
    print(f'\n📍 위치별:')
    print(f'   - 웨슬리홀: {sum(1 for m in members if m["location"] == "웨슬리홀")}명')
    print(f'   - 칼빈채플: {sum(1 for m in members if m["location"] == "칼빈채플")}명')
    print(f'   - 자모영아실: {sum(1 for m in members if m["location"] == "자모영아실")}명')
    
    print(f'\n📊 연령대별:')
    print(f'   - 50세 이상: {sum(1 for m in members if m["age"] >= 50)}명')
    print(f'   - 50세 미만: {sum(1 for m in members if 0 < m["age"] < 50)}명')
    
    # 팀별 통계
    teams = {}
    for member in members:
        team = member['team']
        teams[team] = teams.get(team, 0) + 1
    
    print(f'\n👥 조별 인원:')
    for team, count in sorted(teams.items()):
        print(f'   - {team}: {count}명')

if __name__ == '__main__':
    import sys
    
    print('=' * 60)
    print('📋 교리교육 조배치 데이터 업데이트 스크립트')
    print('=' * 60)
    
    # CSV 파일 결정
    if len(sys.argv) > 1:
        # 명령행 인자로 파일명 지정
        csv_filename = sys.argv[1]
    else:
        # 자동으로 최신 CSV 파일 찾기
        csv_filename = find_latest_csv()
        if not csv_filename:
            print('❌ CSV 파일을 찾을 수 없습니다!')
            print('사용법: python update_data.py [CSV파일명]')
            sys.exit(1)
        print(f'🔍 최신 CSV 파일 발견: {csv_filename}')
    
    if not os.path.exists(csv_filename):
        print(f'❌ 파일을 찾을 수 없습니다: {csv_filename}')
        sys.exit(1)
    
    # 변환 실행
    try:
        members = convert_csv_to_json(csv_filename)
        save_json(members)
        print_statistics(members)
        
        print('\n✨ 업데이트 완료!')
        
    except Exception as e:
        print(f'\n❌ 오류 발생: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)

