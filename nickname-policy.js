(function(root){
  'use strict';
  // A conservative local list, not an official or exhaustive industry blacklist.
  const blockedMessage='このニックネームは使用できません。別の名前を入力してください。';
  function normalize(value){
    return value.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
  }
  const phrases=['死ね','しね','死んで','自殺しろ','じさつしろ','殺す','ころす','殺してやる','くたばれ','きちがい','基地外','障害者消えろ','黒人消えろ','白人消えろ','日本人消えろ','中国人消えろ','韓国人消えろ','朝鮮人消えろ','ちゃんころ','まんこ','おまんこ','ちんこ','ちんぽ','ふぇら','せっくす','れいぷ','児童ぽるの','援助交際募集','ぱぱ活募集','大麻販売','覚醒剤販売','kill yourself','kill all jews','heil hitler','white power','nigger','nigga','faggot','motherfucker'];
  const compact=value=>normalize(value).replace(/[\p{P}\p{Z}\p{S}\s]/gu,'');
  // Short insults use whole-name/token matches to avoid ordinary names such as しねま.
  const short=new Set(['死ね','しね','死んで','殺す','ころす','くそ','ばか','あほ','fuck','shit','bitch','cunt','dick','cock','pussy','sex','porn','nazi','kys'].map(compact));
  const long=phrases.filter(word=>!short.has(compact(word))).map(compact);
  function validate(value){
    const fail=message=>({ok:false,message,nickname:''});
    if(typeof value!=='string'||!value.trim())return fail('ニックネームを入力してください。');
    const nickname=value.trim();
    if([...nickname].length>16)return fail('ニックネームは1〜16文字で入力してください。');
    // Reject invisible formatting and bidi controls, including hidden-only names.
    if(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(value))return fail(blockedMessage);
    const name=normalize(nickname),joined=compact(name);
    if(!/[\p{L}\p{N}]/u.test(name))return fail('ニックネームに文字か数字を含めてください。');
    const tokens=name.split(/[\p{P}\p{Z}\p{S}\s\d]+/u).filter(Boolean);
    const english=joined.replace(/[013457@$]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s'}[c]));
    if(short.has(joined)||short.has(joined.replace(/\d/g,''))||short.has(english)||tokens.some(t=>short.has(t))||long.some(word=>joined.includes(word)||english.includes(word)))return fail(blockedMessage);
    if(/(?:お前|おまえ|みんな|全員).*(?:死ね|しね|殺す|ころす)/u.test(joined))return fail(blockedMessage);
    // Reserve operator titles, without reserving ordinary words like GM as substrings.
    if(/^(?:(?:1234)?(?:りばーし|reversi))?(?:運営|管理者|管理人|公式|admin|administrator|moderator|official|support)(?:チーム|ちーむ|team|\d)*$/u.test(joined))return fail(blockedMessage);
    if(/https?:|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(name))return fail(blockedMessage);
    return {ok:true,message:'',nickname};
  }
  const policy={validate,displayName:value=>validate(value).ok?value:'プレイヤー'};
  if(typeof module==='object'&&module.exports)module.exports=policy;
  else root.NicknamePolicy=policy;
})(typeof globalThis!=='undefined'?globalThis:this);
