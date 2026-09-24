import re

filepath = r'e:\development\SikkaPlay\backend\src\routes\admin.routes.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(r"\'", "'")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
