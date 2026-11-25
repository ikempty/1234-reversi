import game from '../engine.js';
import nicknamePolicy from '../nickname-policy.js';

export const TURN_MS=120000;
export class ClientError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
export function elo(black,white,outcome){
  const expected=1/(1+10**((white-black)/400));
  const change=Math.round(24*(outcome-expected));
  return [black+change,white-change];
}
export class RankedStore {
  constructor(sql,transaction,now=()=>Date.now()){
    this.sql=sql;this.transaction=transaction;this.now=now;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 1500, wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, match_id TEXT
      );
      CREATE INDEX IF NOT EXISTS rankings ON players(rating DESC);
      CREATE TABLE IF NOT EXISTS queue (player_id TEXT PRIMARY KEY, joined INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, black TEXT NOT NULL, white TEXT NOT NULL, state TEXT NOT NULL,
        deadline INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0,
        winner INTEGER, reason TEXT, delta_black INTEGER, delta_white INTEGER
      );
      CREATE INDEX IF NOT EXISTS deadlines ON matches(finished,deadline);
      CREATE TABLE IF NOT EXISTS registrations (ip_hash TEXT PRIMARY KEY, day INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ranking_resets (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, player_count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ranking_reset_backup (
        reset_id TEXT NOT NULL, player_id TEXT NOT NULL, rating INTEGER NOT NULL,
        wins INTEGER NOT NULL, losses INTEGER NOT NULL, draws INTEGER NOT NULL,
        match_id TEXT, PRIMARY KEY(reset_id,player_id)
      );
    `);
  }
  first(query,...args){return this.sql.exec(query,...args).toArray()[0]||null;}
  player(id){return this.first('SELECT * FROM players WHERE id = ?',id);}
  authenticate(hash){return this.first('SELECT * FROM players WHERE secret_hash = ?',hash);}
  resetRankingsOnce(resetId){
    return this.transaction(()=>{
      if(this.first('SELECT id FROM ranking_resets WHERE id = ?',resetId))return false;
      this.sql.exec('INSERT INTO ranking_reset_backup(reset_id,player_id,rating,wins,losses,draws,match_id) SELECT ?,id,rating,wins,losses,draws,match_id FROM players',resetId);
      this.sql.exec('UPDATE players SET rating=1500,wins=0,losses=0,draws=0');
      // Keep active games running; old finished results must not appear as new-season results.
      this.sql.exec('UPDATE players SET match_id=NULL WHERE match_id IN (SELECT id FROM matches WHERE finished=1)');
      this.sql.exec('INSERT INTO ranking_resets(id,created_at,player_count) SELECT ?,?,COUNT(*) FROM players',resetId,this.now());
      return true;
    });
  }
  register(hash,nickname,ipHash){
    const validation=nicknamePolicy.validate(nickname);
    if(!validation.ok)throw new ClientError(validation.message);
    nickname=validation.nickname;
    return this.transaction(()=>{
      const existing=this.authenticate(hash);
      if(existing){
        if(!this.activeMatch(existing))this.sql.exec('UPDATE players SET nickname = ? WHERE id = ?',nickname,existing.id);
        return this.player(existing.id);
      }
      const day=Math.floor(this.now()/86400000);
      const rate=this.first('SELECT * FROM registrations WHERE ip_hash = ?',ipHash);
      if(rate?.day===day&&rate.count>=20)throw new ClientError('新規プレイヤーの作成上限です。後でお試しください。');
      this.sql.exec('INSERT INTO registrations(ip_hash,day,count) VALUES(?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET day=excluded.day,count=?',ipHash,day,rate?.day===day?rate.count+1:1);
      this.sql.exec('DELETE FROM registrations WHERE day < ?',day-2);
      const id=crypto.randomUUID();
      this.sql.exec('INSERT INTO players(id,secret_hash,nickname) VALUES(?,?,?)',id,hash,nickname);
      return this.player(id);
    });
  }
  activeMatch(player){
    if(!player?.match_id)return null;
    return this.first('SELECT * FROM matches WHERE id = ? AND finished = 0',player.match_id);
  }
  join(id,isConnected=()=>true){
    return this.transaction(()=>{
      const player=this.player(id);if(!player)throw new ClientError('認証が必要です。');
      if(this.activeMatch(player))return [id];
      const validation=nicknamePolicy.validate(player.nickname);
      if(!validation.ok)throw new ClientError(validation.message);
      if(this.first('SELECT player_id FROM queue WHERE player_id = ?',id))return [id];
      const candidates=this.sql.exec('SELECT q.player_id FROM queue q WHERE q.player_id != ? ORDER BY q.joined LIMIT 100',id).toArray();
      let opponent=null;
      for(const item of candidates){
        const candidate=this.player(item.player_id);
        if(!candidate||!nicknamePolicy.validate(candidate.nickname).ok||!isConnected(candidate.id)||this.activeMatch(candidate)){this.cancel(item.player_id);continue;}
        opponent=candidate;break;
      }
      if(!opponent){
        this.sql.exec('UPDATE players SET match_id = NULL WHERE id = ?',id);
        this.sql.exec('INSERT INTO queue(player_id,joined) VALUES(?,?)',id,this.now());return [id];
      }
      const swap=crypto.getRandomValues(new Uint8Array(1))[0]%2;
      const [black,white]=swap?[id,opponent.id]:[opponent.id,id];
      const matchId=crypto.randomUUID();
      this.sql.exec('INSERT INTO matches(id,black,white,state,deadline) VALUES(?,?,?,?,?)',matchId,black,white,JSON.stringify(game.initialState()),this.now()+TURN_MS);
      this.sql.exec('UPDATE players SET match_id = ? WHERE id IN (?,?)',matchId,black,white);
      this.sql.exec('DELETE FROM queue WHERE player_id IN (?,?)',black,white);
      return [black,white];
    });
  }
  cancel(id){this.sql.exec('DELETE FROM queue WHERE player_id = ?',id);return [id];}
  snapshot(id){
    const player=this.player(id);if(!player)throw new ClientError('認証が必要です。');
    const profile={id:player.id,nickname:nicknamePolicy.displayName(player.nickname),rating:player.rating,wins:player.wins,losses:player.losses,draws:player.draws};
    const row=player.match_id?this.first('SELECT * FROM matches WHERE id = ?',player.match_id):null;
    let match=null;
    if(row){
      const color=row.black===id?1:2,black=this.player(row.black),white=this.player(row.white);
      match={id:row.id,state:JSON.parse(row.state),color,black:{nickname:nicknamePolicy.displayName(black.nickname),rating:black.rating},white:{nickname:nicknamePolicy.displayName(white.nickname),rating:white.rating},deadline:row.deadline,winner:row.winner,reason:row.reason,delta:color===1?row.delta_black:row.delta_white};
    }
    return {type:'snapshot',profile,queued:!!this.first('SELECT player_id FROM queue WHERE player_id = ?',id),match,serverTime:this.now()};
  }
  move(id,message){
    return this.transaction(()=>{
      const row=this.first('SELECT * FROM matches WHERE id = ?',String(message.matchId));
      if(!row||![row.black,row.white].includes(id))throw new ClientError('この対戦には参加していません。');
      if(row.finished)throw new ClientError('対戦は終了しています。');
      const state=JSON.parse(row.state);
      if(row.deadline<=this.now())return this.finish(row,3-state.current,'timeout');
      const color=row.black===id?1:2;
      if(state.current!==color)throw new ClientError('相手の手番です。');
      if(message.version!==state.moves)throw new ClientError('盤面が更新されています。再接続してください。');
      const next=game.play(state,message.shape,message.row,message.col);
      if(!next)throw new ClientError('その場所には置けません。');
      row.state=JSON.stringify(next);
      this.sql.exec('UPDATE matches SET state = ?,deadline = ? WHERE id = ?',row.state,this.now()+TURN_MS,row.id);
      if(next.over){const counts=game.score(next);return this.finish(row,counts[1]===counts[2]?0:counts[1]>counts[2]?1:2,'normal');}
      return [row.black,row.white];
    });
  }
  resign(id,matchId){
    return this.transaction(()=>{
      const row=this.first('SELECT * FROM matches WHERE id = ?',String(matchId));
      if(!row||![row.black,row.white].includes(id))throw new ClientError('この対戦には参加していません。');
      if(row.finished)return [row.black,row.white];
      const state=JSON.parse(row.state);
      return this.finish(row,row.deadline<=this.now()?3-state.current:row.black===id?2:1,row.deadline<=this.now()?'timeout':'resign');
    });
  }
  finish(row,winner,reason){
    if(this.first('SELECT finished FROM matches WHERE id = ?',row.id)?.finished)return [row.black,row.white];
    const black=this.player(row.black),white=this.player(row.white);
    const ratings=elo(black.rating,white.rating,winner===0?.5:winner===1?1:0);
    const state=JSON.parse(row.state);state.over=true;
    this.sql.exec('UPDATE matches SET state=?,finished=1,winner=?,reason=?,delta_black=?,delta_white=? WHERE id=?',JSON.stringify(state),winner,reason,ratings[0]-black.rating,ratings[1]-white.rating,row.id);
    for(const [index,player]of[black,white].entries()){
      const color=index+1;
      this.sql.exec('UPDATE players SET rating=?,wins=wins+?,losses=losses+?,draws=draws+? WHERE id=?',ratings[index],winner===color?1:0,winner!==0&&winner!==color?1:0,winner===0?1:0,player.id);
    }
    return [row.black,row.white];
  }
  expire(){return this.transaction(()=>{
    const affected=[];
    for(const row of this.sql.exec('SELECT * FROM matches WHERE finished=0 AND deadline<=?',this.now()).toArray())affected.push(...this.finish(row,3-JSON.parse(row.state).current,'timeout'));
    return [...new Set(affected)];
  });}
  nextDeadline(){return this.first('SELECT MIN(deadline) AS deadline FROM matches WHERE finished=0')?.deadline;}
  rankings(){return this.sql.exec('SELECT nickname,rating,wins,losses,draws FROM players WHERE wins+losses+draws > 0 ORDER BY rating DESC,wins DESC,id LIMIT 50').toArray().map(player=>({...player,nickname:nicknamePolicy.displayName(player.nickname)}));}
}
