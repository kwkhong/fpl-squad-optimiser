import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
const html=fs.readFileSync(new URL('../fxedge/index.html',import.meta.url),'utf8');
for(const id of ['rate','trend','score','bias','bullProb','baseProb','bearProb','divergence','updated'])test(`dashboard contains ${id}`,()=>assert.match(html,new RegExp(`id=["']${id}["']`)));
test('dashboard preserves no-demo policy',()=>assert.match(html,/No silent demo data|never invented/i));
