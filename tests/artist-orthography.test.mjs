import test from 'node:test';
import assert from 'node:assert/strict';
import {artistOrthographyKey as key, artistOrthographyVariants as variants} from '../lib/catalog/artist-orthography.ts';
test('real Rock am Ring publication spellings match canonical formatting only',()=>{
  assert.equal(key('Hanabie'),key('HANABIE.'));
  assert.equal(key('Maple’s Pet Dinosaur'),key("Maple's Pet Dinosaur"));
  assert.ok(variants('Hanabie').includes('Hanabie.'));
  assert.ok(variants('Maple’s Pet Dinosaur').includes("Maple's Pet Dinosaur"));
});
test('other slug collisions and substantive punctuation remain distinct',()=>{
  for(const [a,b] of [['AC/DC','AC DC'],['Band!','Band'],['Band..','Band'],['A.B','AB'],['Maples Pet Dinosaur',"Maple's Pet Dinosaur"],['Artist','Artist Other']]) assert.notEqual(key(a),key(b));
});
