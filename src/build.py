# Builds ../index.html from template.html, engine.js and ui.js.
import os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda n: open(os.path.join(here, n), encoding='utf-8').read()
t = rd('template.html').replace('/*ENGINE*/', rd('engine.js')).replace('/*UI*/', rd('ui.js'))
open(os.path.join(here, '..', 'index.html'), 'w', encoding='utf-8').write(t)
print(len(t), 'bytes written to index.html')
