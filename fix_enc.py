with open('backend/main.py', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('open(os.path.join(sdir(name), "meta.json"))', 'open(os.path.join(sdir(name), "meta.json"), encoding="utf-8")')
code = code.replace('open(os.path.join(sdir(name), "meta.json"), "w")', 'open(os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8")')
code = code.replace('open(p)', 'open(p, encoding="utf-8")')
code = code.replace('open(meta_path)', 'open(meta_path, encoding="utf-8")')
code = code.replace('open(prop)', 'open(prop, encoding="utf-8")')
code = code.replace('open(pp)', 'open(pp, encoding="utf-8")')
code = code.replace('open(pp, "w")', 'open(pp, "w", encoding="utf-8")')

with open('backend/main.py', 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated remaining encodings.")
