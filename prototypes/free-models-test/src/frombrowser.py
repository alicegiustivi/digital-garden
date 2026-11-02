# PROTOTYPE (issue 12): save text read through the built-in browser as a Source file.
import json, sys, re
src, url, out = sys.argv[1:4]
t = json.load(open(src))[0]['text']
title = re.search(r'^Title: (.*)$', t, re.M).group(1)
body = t.split('---\n', 1)[1]
json.dump({'url': url, 'title': title, 'text': body.strip()}, open(out, 'w'), indent=1)
print(out.split('/')[-1], title[:70], '|', len(body), 'chars')
