const {test}=require('node:test');
const assert=require('node:assert/strict');
const policy=require('./nickname-policy.js');
test('rejects clear abuse, obfuscation, impersonation and contact advertising',()=>{
  for(const name of ['死ね','し ね','シネ123','くたばれ太郎','ＦＵＣＫ','f.u.c.k','sh1t','kill yourself','お前死ね','まんこ','運営','1234リバーシ公式','admin2','a@example.com','a\u200bb','\u2800','\u3164'])assert.equal(policy.validate(name).ok,false,name);
});
test('ordinary names and coincidental substrings are accepted',()=>{
  for(const name of ['Alice','Bob','Guest','Network A','しねま','Scunthorpe','Cass','classical','Dickinson','チョン・ミン','日本人','中国人','さくら🌸','太郎123','1234','山田','GM太郎'])assert.equal(policy.validate(name).ok,true,name);
  assert.equal(policy.validate('  太郎  ').nickname,'太郎');
});
test('invalid input is rejected safely and old names are hidden',()=>{
  for(const name of ['', '　 ',null,{},'a'.repeat(17),'\nAlice'])assert.equal(policy.validate(name).ok,false);
  assert.equal(policy.displayName('死ね'),'プレイヤー');
});
