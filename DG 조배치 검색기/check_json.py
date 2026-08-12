import json

try:
    with open('data.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f'JSON OK! Total: {len(data)} members')
    print(f'Last member: {data[-1]}')
except json.JSONDecodeError as e:
    print(f'JSON ERROR: {e}')
except Exception as e:
    print(f'ERROR: {e}')

