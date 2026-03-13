import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, off, runTransaction }



  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ------------------------------------------------
//  ⚙️  CẤU HÌNH — điền vào đây
// ------------------------------------------------
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBwl9j1V_PEP_5etnhhAUR1UUU3bfpx8uI",
  authDomain: "friendgame-63fb3.firebaseapp.com",
  databaseURL: "https://friendgame-63fb3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "friendgame-63fb3",
  storageBucket: "friendgame-63fb3.firebasestorage.app",
  messagingSenderId: "675984454167",
  appId: "1:675984454167:web:33e0e76b154dc1c409a252"
};
const GAS_URL = "https://script.google.com/macros/s/AKfycbwGfPyXJcgay2MdZQI0bSezduzfJZZPVv_ZIS18gK-E2xYdLL5g5ZuoXJsCvkXpYxZb/exec";

// ------------------------------------------------
//  FIREBASE INIT
// ------------------------------------------------
const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ------------------------------------------------
//  KEYWORDS
// ------------------------------------------------
let _keywords = null;
async function getKeywords() {
  if (_keywords) return _keywords;
  try {
    const snap = await get(ref(db, 'keywords'));
    if (snap.exists()) {
      const val = snap.val();
      _keywords = Array.isArray(val) ? val : Object.values(val);
      return _keywords;
    }
  } catch(e) { console.warn('keywords error:', e); }
  _keywords = [
    ["Táo","Lê","Mận","Đào"], ["Cam","Quýt","Bưởi","Chanh"],
    ["Bệnh viện","Phòng khám","Trạm y tế","Nhà thuốc"],
    ["Cà phê đen","Cà phê sữa","Cà phê latte","Capuccino"],
    ["Nhà hàng","Quán ăn","Quán cơm","Quán phở"],
  ];
  toast('⚠️ Dùng từ khoá tạm');
  return _keywords;
}

// ------------------------------------------------
//  STATE
// ------------------------------------------------
const S = {
  roomId:'', playerId:'', playerName:'', myWord:null,
  roomListener:null, chatListener:null, _inDiscussion:false,
  timerInterval:null, timerRemaining:120, timerRunning:false,
  selectedVote:null, earlyVoteChoice:null, earlyVoted:false,
  votedThisRound:false, voteTimerInterval:null,
  cardFlipped:false, cardConfirmed:false, spyGuessSubmitted:false,
  chatCollapsed:true, chatUnread:0,
  _lastRound:null, _lastStatus:null,
  isBotBattle:false,
  isObserver:false,
};
let _autoBotVoteDone = false;
let _autoBotSpyGuessDone = false;
let _botBattleAdvanceTimer = null;
let _bbChatLog = [];
const _botActionLog = {};
function logBotAction(botId, type, text, suspectName) {
  if (!_botActionLog[botId]) _botActionLog[botId] = [];
  _botActionLog[botId].push({ type, text, suspectName: suspectName||'', ts: Date.now() });
}
function clearBotActionLog() {
  Object.keys(_botActionLog).forEach(k => delete _botActionLog[k]);
}
let _wordPickedUp = false;

// ------------------------------------------------
//  PERSIST
// ------------------------------------------------
function save() {
  try { localStorage.setItem('gd_fb1', JSON.stringify(
    {roomId:S.roomId, playerId:S.playerId, playerName:S.playerName, myWord:S.myWord}
  )); } catch(e) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('gd_fb1')||'null');
    if (d) { S.roomId=d.roomId||''; S.playerId=d.playerId||''; S.playerName=d.playerName||''; S.myWord=d.myWord||null; }
  } catch(e) {}
}

// ------------------------------------------------
//  HELPERS
// ------------------------------------------------
function genRoomCode() {
  const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join('');
}
function genId() { return Math.random().toString(36).slice(2,10); }
function randItem(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function loading(on) { document.getElementById('loading').classList.toggle('show',on); }
let _tt;
function toast(msg,dur=3000){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(_tt); _tt=setTimeout(()=>el.classList.remove('show'),dur);
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ------------------------------------------------
//  ROUTER
// ------------------------------------------------
function nav(screen, params) {
  const qs = params ? '?'+Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&') : '';
  location.hash = screen + qs;
}
function parseHash() {
  const raw = location.hash.replace(/^#/,'')||'home';
  const [screen, qs=''] = raw.split('?');
  const params = {};
  if (qs) qs.split('&').forEach(p=>{ const [k,...vs]=p.split('='); if(k) params[k]=decodeURIComponent(vs.join('=')); });
  return {screen,params};
}
window.addEventListener('hashchange', ()=>{
  const {screen,params} = parseHash();
  showScreen(screen);
  if (screen==='join'&&params.room) { const el=document.getElementById('join-code'); if(el) el.value=params.room; }
});
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  (document.getElementById('screen-'+name)||document.getElementById('screen-home')).classList.add('active');
  window.scrollTo(0,0);
}
function copyJoinLink() {
  const link = location.href.split('#')[0]+'#join?room='+S.roomId;
  navigator.clipboard ? navigator.clipboard.writeText(link).then(()=>toast('✓ Đã copy link!'))
                      : prompt('Copy link:',link);
}

// ------------------------------------------------
//  FIREBASE HELPERS
// ------------------------------------------------
function roomRef(id)   { return ref(db,`rooms/${id||S.roomId}`); }
function playerRef(rid,pid) { return ref(db,`rooms/${rid}/players/${pid}`); }
function chatRef()     { return ref(db,`rooms/${S.roomId}/chat`); }

async function getRoom(roomId) {
  const snap = await get(roomRef(roomId||S.roomId));
  return snap.exists() ? snap.val() : null;
}

// ------------------------------------------------
//  REALTIME LISTENER
// ------------------------------------------------
function listenRoom(roomId) {
  stopListening();
  const r = ref(db,`rooms/${roomId}`);
  const unsubRoom = onValue(r, snap => {
    if (!snap.exists()) { toast('Phòng không tồn tại.'); doLeave(); return; }
    const room = snap.val();
    room.playerList = room.players ? Object.values(room.players) : [];
    handleRoomUpdate(room);
  });
  S.roomListener = () => { unsubRoom(); S.roomListener=null; };
}
function stopListening() {
  if (S.roomListener) { S.roomListener(); S.roomListener=null; }
  if (S.chatListener) { S.chatListener(); S.chatListener=null; }
  S._inDiscussion=false;
}

// ------------------------------------------------
//  ROOM UPDATE HANDLER
// ------------------------------------------------
function handleRoomUpdate(room) {
  tryPickUpWord(room);

  if (room.status==='playing' && room.roundNumber!==S._lastRound) {
    S._lastRound=room.roundNumber;
    S.cardFlipped=false; S.cardConfirmed=false;
    S.votedThisRound=false; S.earlyVoted=false; S.earlyVoteChoice=null;
    S.spyGuessSubmitted=false; _wordPickedUp=false;
    _autoBotVoteDone=false; _autoBotSpyGuessDone=false;
    if (_botBattleAdvanceTimer) { clearTimeout(_botBattleAdvanceTimer); _botBattleAdvanceTimer=null; }
    clearBotActionLog();
  }

  // Phòng bot battle: observer flow
  if (room.isBotBattle) {
    handleBotBattleFlow(room);
    return;
  }

  const status=room.status, cur=parseHash().screen;

  if (status==='waiting') {
    if (cur!=='lobby') nav('lobby',{room:S.roomId});
    renderLobby(room); return;
  }
  if (status==='playing') {
    if (!S.myWord) fetchMyWord(room);
    if (cur!=='card') showCardScreen(room); else updateCardConfirmCount(room);
    return;
  }
  if (status==='discussing') {
    if (!S._inDiscussion) { startDiscussionScreen(room); }
    else { updateTableAvatars(room); updateDiscVoteStatus(room); }
    return;
  }
  if (status==='voting') {
    S._inDiscussion=false;
    if (cur!=='vote') {
      S.votedThisRound=false;
      renderVote(room); nav('vote',{room:S.roomId}); startVoteTimer(room);
    } else { updateVoteStatus(room); }
    return;
  }
  if (status==='votesummary') {
    S._inDiscussion=false;
    if (cur!=='votesummary') showVoteSummary(room); return;
  }
  if (status==='spyguess') {
    S._inDiscussion=false;
    if (cur!=='spyguess') showSpyGuess(room); return;
  }
  if (status==='result') {
    S._inDiscussion=false;
    if (cur!=='result') showResult(room); return;
  }
}

// ------------------------------------------------
//  WORD PICKUP
// ------------------------------------------------
async function fetchMyWord(room) {
  const saved = S.myWord;
  if (saved) { updateWordDisplay(); return; }
  try {
    const snap = await get(ref(db,`words/${S.roomId}/${S.playerId}`));
    if (snap.exists()) { S.myWord=snap.val(); save(); updateWordDisplay(); showCardScreen(room); }
  } catch(e) {}
}
function updateWordDisplay() {
  const el=document.getElementById('cf-word'); if(el&&S.myWord) el.textContent=S.myWord;
  const el2=document.getElementById('tb-word-display'); if(el2) el2.textContent=S.myWord||'—';
}
function tryPickUpWord(room) {
  if (_wordPickedUp||!room._wordAssignments) return;
  const myWord=room._wordAssignments[S.playerId]; if(!myWord) return;
  _wordPickedUp=true; S.myWord=myWord; save(); updateWordDisplay();
  setTimeout(()=>{
    update(ref(db),{[`rooms/${S.roomId}/_wordAssignments/${S.playerId}`]:null}).catch(()=>{});
    if (room.hostId===S.playerId) {
      const rem=Object.keys(room._wordAssignments).filter(id=>id!==S.playerId);
      if (!rem.length) { update(ref(db),{[`rooms/${S.roomId}/_wordAssignments`]:null}).catch(()=>{}); }
      else setTimeout(async()=>{
        try {
          const snap=await get(ref(db,`rooms/${S.roomId}/_wordAssignments`));
          if (!snap.exists()||!Object.keys(snap.val()||{}).length)
            await update(ref(db),{[`rooms/${S.roomId}/_wordAssignments`]:null});
        } catch(e){}
      },2000);
    }
  },0);
}

// ------------------------------------------------
//  CLEAN OLD ROOMS
// ------------------------------------------------
async function cleanOldRooms() {
  try {
    const snap=await get(ref(db,'rooms')); if(!snap.exists()) return;
    const cutoff=Date.now()-6*60*60*1000, updates={};
    snap.forEach(c=>{ if((c.val().createdAt||0)<cutoff) updates['rooms/'+c.key]=null; });
    if (Object.keys(updates).length) await update(ref(db),updates);
  } catch(e){}
}

// ------------------------------------------------
//  CREATE / JOIN
// ------------------------------------------------
async function doCreateRoom() {
  const name=document.getElementById('create-name').value.trim();
  if (!name) { toast('Hãy nhập tên!'); return; }
  loading(true);
  try {
    await cleanOldRooms();
    let roomId,exists;
    do { roomId=genRoomCode(); exists=(await get(roomRef(roomId))).exists(); } while(exists);
    const playerId=genId();
    S.roomId=roomId; S.playerId=playerId; S.playerName=name; S.myWord=null; save();
    await set(roomRef(roomId),{
      id:roomId, createdAt:Date.now(), status:'waiting', hostId:playerId, roundNumber:0,
      players:{[playerId]:{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false}}
    });
    listenRoom(roomId); nav('lobby',{room:roomId});
  } catch(e){toast('❌ Lỗi: '+e.message);console.error(e);}
  finally{loading(false);}
}
async function doJoinRoom() {
  const code=document.getElementById('join-code').value.trim().toUpperCase();
  const name=document.getElementById('join-name').value.trim();
  if (!code||code.length!==4) { toast('Nhập mã 4 ký tự!'); return; }
  if (!name) { toast('Hãy nhập tên!'); return; }
  loading(true);
  try {
    const room=await getRoom(code);
    if (!room) { toast('Không tìm thấy phòng!'); return; }
    if (room.status!=='waiting') { toast('Game đã bắt đầu!'); return; }
    const players=Object.values(room.players||{});
    if (players.length>=8) { toast('Phòng đầy!'); return; }
    if (players.some(p=>p.name.toLowerCase()===name.toLowerCase())) { toast('Tên đã dùng!'); return; }
    const playerId=genId();
    S.roomId=code; S.playerId=playerId; S.playerName=name; S.myWord=null; save();
    await set(playerRef(code,playerId),{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false});
    listenRoom(code); nav('lobby',{room:code});
  } catch(e){toast('❌ '+e.message);console.error(e);}
  finally{loading(false);}
}

// ------------------------------------------------
//  LOBBY
// ------------------------------------------------
function renderLobby(room) {
  const players=room.playerList||Object.values(room.players||{});
  document.getElementById('lobby-code').textContent=room.id;
  document.getElementById('lobby-count').textContent=players.length;
  const me=players.find(p=>p.id===S.playerId);
  const iAmReady=me?.ready||false, isHost=room.hostId===S.playerId;
  const botCount=players.filter(p=>p.isBot).length;
  document.getElementById('lobby-player-list').innerHTML=players.map(p=>{
    const b=[];
    if(p.id===room.hostId) b.push('<span class="pbadge host-badge">HOST</span>');
    if(p.isBot)            b.push('<span class="pbadge bot-badge">🤖 BOT</span>');
    if(p.id===S.playerId)  b.push('<span class="pbadge you-badge">BẠN</span>');
    b.push(p.ready?'<span class="pbadge ready-badge">✓ SẴN SÀNG</span>':'<span class="pbadge wait-badge">CHỜ...</span>');
    return `<div class="player-row${p.isBot?' bot-row':''}"><span class="pname">${esc(p.name)}</span><span style="display:flex;gap:5px">${b.join('')}</span></div>`;
  }).join('');
  const btn=document.getElementById('btn-ready');
  if (iAmReady){btn.textContent='✕ HỦY';btn.className='btn full red';} else {btn.textContent='✓ SẴN SÀNG';btn.className='btn full green';}
  btn.style.maxWidth='320px';
  document.getElementById('bot-buttons').classList.toggle('hidden',!isHost);
  document.getElementById('btn-remove-bot').classList.toggle('hidden',!(isHost&&botCount>0));
  const readyCount=players.filter(p=>p.ready).length;
  const st=document.getElementById('lobby-status-text');
  if(players.length<3){st.textContent=`Cần ít nhất 3 người (hiện có ${players.length})`;st.className='muted dots';}
  else if(readyCount<players.length){st.textContent=`${readyCount}/${players.length} đã sẵn sàng...`;st.className='muted dots';}
  else{st.textContent='Tất cả sẵn sàng! Đang bắt đầu...';st.className='muted';}
}
async function doToggleReady() {
  loading(true);
  try {
    const kw=await getKeywords();
    await runTransaction(roomRef(),room=>{
      if(!room?.players?.[S.playerId]) return room;
      room.players[S.playerId].ready=!room.players[S.playerId].ready;
      const players=Object.values(room.players);
      if(players.length>=3&&players.every(p=>p.ready)) beginRoundTx(room,kw);
      return room;
    });
  } catch(e){toast('Lỗi: '+e.message);console.error(e);}
  finally{loading(false);}
}
async function doAddBot() {
  loading(true);
  try {
    const kw=await getKeywords();
    await runTransaction(roomRef(),room=>{
      if(!room||room.status!=='waiting') return room;
      const players=Object.values(room.players||{});
      if(players.length>=8){toast('Phòng đầy!');return room;}
      const botNames=["Bot Alpha","Bot Beta","Bot Gamma","Bot Delta","Bot Epsilon","Bot Zeta"];
      const used=players.map(p=>p.name);
      const name=botNames.find(n=>!used.includes(n))||('Bot '+genId().slice(0,4));
      const botId='bot_'+genId();
      room.players[botId]={id:botId,name,ready:true,score:0,isBot:true,cardConfirmed:false};
      if(Object.values(room.players).length>=3&&Object.values(room.players).every(p=>p.ready)) beginRoundTx(room,kw);
      return room;
    });
  } catch(e){toast('Lỗi: '+e.message);console.error(e);}
  finally{loading(false);}
}
async function doRemoveBot() {
  loading(true);
  try {
    await runTransaction(roomRef(),room=>{
      if(!room) return room;
      const bot=[...Object.values(room.players||{})].reverse().find(p=>p.isBot);
      if(bot) delete room.players[bot.id];
      return room;
    });
  } catch(e){toast('Lỗi: '+e.message);console.error(e);}
  finally{loading(false);}
}

// ------------------------------------------------
//  BEGIN ROUND
// ------------------------------------------------
function beginRoundTx(room,keywords) {
  const row=randItem(keywords), shuffled=[...row].sort(()=>Math.random()-.5);
  const wordA=shuffled[0], wordB=shuffled[1];
  const players=Object.values(room.players), spy=randItem(players);
  room.status='playing'; room.roundNumber=(room.roundNumber||0)+1;
  room.round={wordA,wordB,spyId:spy.id,votes:{},voteCounts:{},spyGuess:null,result:null,discussStartAt:null,discussDuration:90};
  room._wordAssignments={};
  players.forEach(p=>{
    room._wordAssignments[p.id]=(p.id===spy.id)?wordB:wordA;
    p.cardConfirmed=!!p.isBot; p.ready=false; p.eliminated=false;
  });
  if(players.every(p=>p.cardConfirmed)){
    room.status='discussing'; room.round.discussStartAt=Date.now(); room.round.chatStartTs=Date.now(); delete room._wordAssignments;
  }
  return room;
}

// ------------------------------------------------
//  CARD
// ------------------------------------------------
function showCardScreen(room) {
  const el=document.getElementById('cf-word'); if(el) el.textContent=S.myWord||'...';
  updateCardConfirmCount(room);
  document.getElementById('card-wrap').classList.remove('flipped');
  document.getElementById('btn-confirm-card').disabled=true;
  document.getElementById('btn-confirm-card').textContent='ĐÃ GHI NHỚ ✓';
  document.getElementById('card-waiting-others').style.display='none';
  nav('card',{room:S.roomId});
}
function updateCardConfirmCount(room) {
  const players=room.playerList||Object.values(room.players||{});
  const humans=players.filter(p=>!p.isBot), confirmed=humans.filter(p=>p.cardConfirmed).length;
  const el=document.getElementById('card-confirm-count'); if(el) el.textContent=`${confirmed}/${humans.length} người đã xem xong`;
}
function flipCard() {
  if(!S.cardFlipped){S.cardFlipped=true;document.getElementById('card-wrap').classList.add('flipped');document.getElementById('btn-confirm-card').disabled=false;updateWordDisplay();}
}
async function doConfirmCard() {
  if(!S.cardFlipped){toast('Hãy lật thẻ trước!');return;}
  S.cardConfirmed=true;
  document.getElementById('btn-confirm-card').disabled=true;
  document.getElementById('btn-confirm-card').textContent='✓ ĐÃ GHI NHỚ';
  document.getElementById('card-waiting-others').style.display='block';
  await runTransaction(roomRef(),room=>{
    if(!room?.players?.[S.playerId]) return room;
    room.players[S.playerId].cardConfirmed=true;
    if(Object.values(room.players).every(p=>p.cardConfirmed)){
      room.status='discussing'; room.round.discussStartAt=Date.now(); room.round.chatStartTs=Date.now();
    }
    return room;
  });
}

// ------------------------------------------------
//  -------  ------- ---   -------   ----------
//  --------------------   --------  -----------
//  -----------   ------   --------- ------  ---
//  -----------   ------   ----------------  ---
//  ---  ------------------------ --------------
//  TABLE SCREEN  (replaces discussion screen)
// ------------------------------------------------

let _botHintTimers = [];
let _lastRoom = null;

function startDiscussionScreen(room) {
  if (S._inDiscussion) {
    _lastRoom=room;
    updateTableAvatars(room);
    updateDiscVoteStatus(room);
    return;
  }
  S._inDiscussion=true;

  _lastRoom = room;
  S.earlyVoteChoice=null;
  S.earlyVoted=!!(room.round?.earlyVotes?.[S.playerId]);

  // Top bar
  document.getElementById('tb-round-badge').textContent='VÒNG '+(room.roundNumber||1);
  document.getElementById('tb-word-display').textContent=S.myWord||'—';

  // Timer
  const startAt=room.round?.discussStartAt||Date.now();
  const duration=room.round?.discussDuration||120;
  S.timerRemaining=Math.max(0,duration-Math.floor((Date.now()-startAt)/1000));
  if(S.timerInterval) clearInterval(S.timerInterval);
  S.timerRunning=true;
  updateTableTimer();
  S.timerInterval=setInterval(()=>{
    S.timerRemaining=Math.max(0,S.timerRemaining-1);
    updateTableTimer();
    if(S.timerRemaining===0){clearInterval(S.timerInterval);S.timerRunning=false;if(!S.isBotBattle)doTimeUpVoting();else doTimeUpVoting();}
  },1000);

  // Tie notice
  const tie=document.getElementById('table-tie-banner');
  if(tie) tie.style.display=room.round?.isTie?'block':'none';

  // Build table
  buildRoundTable(room);

  // Chỉ start chat khi vào màn hình mới
  startChatListener();
  scheduleBotHints(room);

  // Chat collapsed initially
  S.chatCollapsed=true;
  S.chatUnread=0;
  document.querySelector('.chat-panel')?.classList.add('collapsed');
  document.getElementById('chat-unread-badge').classList.remove('show');

  nav('discussion',{room:S.roomId});
}

function updateTableTimer() {
  const m=Math.floor(S.timerRemaining/60), s=S.timerRemaining%60;
  const el=document.getElementById('tb-timer');
  if(!el) return;
  el.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.classList.toggle('urgent',S.timerRemaining<=30&&S.timerRemaining>0);
}

// -- Build round table layout --
function buildRoundTable(room) {
  const players=room.playerList||Object.values(room.players||{});
  const n=players.length;
  const tableEl=document.getElementById('round-table');
  if(!tableEl) return;

  // Remove old player nodes
  tableEl.querySelectorAll('.table-player').forEach(el=>el.remove());

  const size=tableEl.offsetWidth||300;
  const cx=size/2, cy=size/2, r=size*0.42;

  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;

  players.forEach((p,i)=>{
    const angle=(2*Math.PI*i/n)-Math.PI/2;
    const x=cx+r*Math.cos(angle);
    const y=cy+r*Math.sin(angle);

    const wrap=document.createElement('div');
    wrap.className='table-player';
    wrap.id=`tp-${p.id}`;
    wrap.style.left=x+'px';
    wrap.style.top=y+'px';

    // Determine bubble arrow direction based on position
    const sector=Math.atan2(y-cy,x-cx);
    const arrDir=sector>-Math.PI/4&&sector<Math.PI/4?'arr-right':
                 sector>=Math.PI/4&&sector<3*Math.PI/4?'arr-down':
                 sector<=-Math.PI/4&&sector>-3*Math.PI/4?'arr-up':'arr-left';

    const isMe=p.id===S.playerId;
    const canClick=!iAmEliminated&&!isMe&&!p.eliminated&&!S.earlyVoted;
    const emoji=p.isBot?'🤖':(isMe?'😊':['👤','🧑','👩','🙂','😐','🧐'][i%6]);
    const hasVoted=!!(room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]);

    wrap.innerHTML=`
      <div class="speech-bubble ${arrDir}" id="bubble-${p.id}"></div>
      <div class="avatar${isMe?' is-me':''}${p.eliminated?' eliminated':''}${canClick?' vote-target':''}" id="avatar-${p.id}" style="${canClick?'cursor:pointer;':''}">
        ${emoji}
        <div class="avatar-voted-badge${hasVoted?' show':''}" id="voted-${p.id}">✓</div>
        ${p.eliminated?'<div class="avatar-elim-badge">✕</div>':''}
        <div class="avatar-vote-ring" id="ring-${p.id}"></div>
      </div>
      <div class="avatar-name${isMe?' is-me':''}">${esc(p.name)}</div>
    `;
    if(canClick){
      const av=wrap.querySelector(`#avatar-${p.id}`);
      av.addEventListener('click',()=>handleAvatarVoteClick(p.id,players));
    }
    tableEl.appendChild(wrap);
  });

  const active=players.filter(p=>!p.eliminated).length;
  document.getElementById('table-center-text').textContent=`${active} người`;

  updateDiscVoteStatus(room);
}

function handleAvatarVoteClick(targetId, players) {
  if(S.earlyVoted) return;
  S.earlyVoteChoice = S.earlyVoteChoice===targetId ? null : targetId;
  players.forEach(p=>{
    const ring=document.getElementById(`ring-${p.id}`);
    const av=document.getElementById(`avatar-${p.id}`);
    const sel=S.earlyVoteChoice===p.id;
    if(ring) ring.style.opacity=sel?'1':'0';
    if(av) av.style.boxShadow=sel?'0 0 0 3px var(--red)':'';
  });
  updateAvatarVoteBtn();
}

function updateAvatarVoteBtn() {
  let btn=document.getElementById('avatar-vote-confirm-btn');
  if(!S.earlyVoteChoice){
    if(btn) btn.remove();
    return;
  }
  if(!btn){
    btn=document.createElement('button');
    btn.id='avatar-vote-confirm-btn';
    btn.className='btn red full';
    btn.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:300;max-width:280px;width:calc(100% - 32px);box-shadow:0 4px 20px rgba(192,57,43,.5)';
    btn.innerHTML='<span>GUI PHIEU →</span>';
    btn.onclick=doEarlyVote;
    document.body.appendChild(btn);
  }
}

function updateTableAvatars(room) {
  if(!room) return;
  _lastRoom=room;
  if(S.isBotBattle) updateBotBattleOverlay(room);
  const players=room.playerList||Object.values(room.players||{});
  players.forEach(p=>{
    const av=document.getElementById(`avatar-${p.id}`);
    const vb=document.getElementById(`voted-${p.id}`);
    const hasVoted=!!(room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]);
    if(av){
      av.classList.toggle('eliminated',!!p.eliminated);
      if(p.eliminated&&!av.querySelector('.avatar-elim-badge')){
        const x=document.createElement('div');x.className='avatar-elim-badge';x.textContent='✕';av.appendChild(x);
      }
    }
    if(vb) vb.classList.toggle('show',hasVoted);
  });
  updateDiscVoteStatus(room);
}

// -- Vote status below table --
function updateDiscVoteStatus(room) {
  if(!room) return;
  const players=room.playerList||Object.values(room.players||{});
  const humans=players.filter(p=>!p.isBot&&!p.eliminated);
  const voted=humans.filter(p=>room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]).length;
  const el=document.getElementById('disc-voted-count');
  if(el) el.textContent=voted===humans.length?`✓ Tất cả ${humans.length} người đã vote`:`${voted}/${humans.length} người đã gửi phiếu`;

  // Show/hide early vote panel
  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;
  const earlyPanel=document.getElementById('disc-early-vote-section');
  if(earlyPanel) earlyPanel.style.display='none';
  const votedNotice=document.getElementById('disc-voted-notice');
  if(votedNotice) votedNotice.style.display=(S.earlyVoted&&!iAmEliminated)?'block':'none';
}

function renderDiscVoteGrid(room) {
  const players=room.playerList||Object.values(room.players||{});
  const grid=document.getElementById('disc-vote-grid');
  if(!grid) return;
  grid.innerHTML='';
  S.earlyVoteChoice=null;
  const btn=document.getElementById('disc-btn-vote');
  if(btn) btn.disabled=true;

  players.filter(p=>!p.eliminated).forEach(p=>{
    const b=document.createElement('button');
    b.className='vote-opt';
    b.textContent=(p.isBot?'🤖 ':'')+p.name+(p.id===S.playerId?' (bạn)':'');
    b.onclick=()=>{
      grid.querySelectorAll('.vote-opt').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel'); S.earlyVoteChoice=p.id; if(btn) btn.disabled=false;
    };
    grid.appendChild(b);
  });
  const ab=document.createElement('button');
  ab.className='vote-opt abstain'; ab.textContent='Bỏ phiếu trắng';
  ab.onclick=()=>{
    grid.querySelectorAll('.vote-opt').forEach(x=>x.classList.remove('sel'));
    ab.classList.add('sel'); S.earlyVoteChoice='abstain'; if(btn) btn.disabled=false;
  };
  grid.appendChild(ab);
}

async function doEarlyVote() {
  if(!S.earlyVoteChoice){toast('Hãy chọn!');return;}
  S.earlyVoted=true; loading(true);
  const confirmBtn=document.getElementById('avatar-vote-confirm-btn');
  if(confirmBtn) confirmBtn.remove();
  try {
    await runTransaction(roomRef(),room=>{
      if(!room||room.status!=='discussing') return room;
      if(!room.round.earlyVotes) room.round.earlyVotes={};
      room.round.earlyVotes[S.playerId]=S.earlyVoteChoice;
      const players=Object.values(room.players||{});
      const humans=players.filter(p=>!p.isBot&&!p.eliminated);
      if(humans.every(p=>room.round.earlyVotes[p.id])){
        room.round.votes={...room.round.earlyVotes};
        players.filter(p=>p.isBot&&!p.eliminated).forEach(bot=>{
          const others=players.filter(p=>p.id!==bot.id&&!p.eliminated);
          if(others.length) room.round.votes[bot.id]=randItem(others).id;
        });
        delete room.round.earlyVotes; resolveVotesTx(room);
      }
      return room;
    });
    // Show bubble for myself
    showBubble(S.playerId,'✓ Đã gửi phiếu',3000);
    updateDiscVoteStatus(_lastRoom||{round:{},players:{}});
  } catch(e){toast('Lỗi: '+e.message);console.error(e);S.earlyVoted=false;}
  finally{loading(false);}
}

// -- Show speech bubble on avatar --
function showBubble(playerId, text, dur=4000) {
  const el=document.getElementById(`bubble-${playerId}`);
  if(!el) return;
  el.textContent=text; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

// -- Mark avatar as speaking --
function setAvatarSpeaking(playerId, on) {
  const el=document.getElementById(`avatar-${playerId}`);
  if(el) el.classList.toggle('speaking',on);
}

// ------------------------------------------------
//  BOT AI HINTS via Claude API
// ------------------------------------------------
// Các loại action bot có thể làm
function scheduleBotHints(room) {
  _botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];
  const players=room.playerList||Object.values(room.players||{});
  const bots=players.filter(p=>p.isBot&&!p.eliminated);
  if(!bots.length) return;
  const duration=(room.round?.discussDuration||90)*1000;

  bots.forEach(bot=>{
    const numActions=2+Math.floor(Math.random()*2);
    const usedSlots=new Set();
    for(let i=0;i<numActions;i++){
      let delay;
      do { delay=6000+Math.random()*(duration*0.8); } while(usedSlots.has(Math.floor(delay/6000)));
      usedSlots.add(Math.floor(delay/6000));
      // Truyền index để action đầu luôn là hint
      const t=setTimeout(()=>triggerBotAction(bot, i),delay);
      _botHintTimers.push(t);
    }
  });
}

async function triggerBotAction(bot, actionIndex) {
  if(parseHash().screen!=='discussion') return;
  const room=_lastRoom;
  if(!room) return;
  const botCurrent=Object.values(room.players||{}).find(p=>p.id===bot.id);
  if(!botCurrent||botCurrent.eliminated) return;

  const isSpy=bot.id===room.round?.spyId;
  const word=isSpy?room.round?.wordB:room.round?.wordA;
  const players=room.playerList||Object.values(room.players||{});
  const others=players.filter(p=>p.id!==bot.id&&!p.eliminated);

  // Đọc chat gần nhất trước khi quyết định action
  let recentChat='';
  let recentMsgs=[];
  try {
    const chatSnap=await get(ref(db,'rooms/'+S.roomId+'/chat'));
    if(chatSnap.exists()){
      recentMsgs=Object.values(chatSnap.val()).sort((a,b)=>a.ts-b.ts).slice(-8);
      recentChat=recentMsgs.map(m=>m.name+': '+(m.text||m.reaction||'')).join('\n');
    }
  } catch(e){}

  // Quyết định action dựa trên context thực tế
  let action;
  if(actionIndex===0){
    action='hint'; // Lượt đầu luôn hint
  } else {
    // Kiểm tra bot có đang bị nhắc tên trong chat không
    const isMentioned=recentMsgs.some(m=>
      m.pid!==bot.id && (m.text||'').toLowerCase().includes(bot.name.toLowerCase())
    );
    if(isMentioned){
      // Bị nhắc tên → bào chữa (cả dân thường lẫn gián điệp)
      action='defend';
    } else {
      // Không bị nhắc → ngẫu nhiên giữa hint/accuse/react
      action=randItem(['hint','accuse','accuse','react','react']);
    }
  }

  // Chọn suspect thông minh hơn: ưu tiên người nói nhiều nhất gần đây
  const msgCountByPlayer={};
  recentMsgs.forEach(m=>{ if(m.pid!==bot.id) msgCountByPlayer[m.pid]=(msgCountByPlayer[m.pid]||0)+1; });

  // Chọn suspect dựa trên suspicion map (nếu đủ bằng chứng) hoặc mostActive
  let suspect = null;
  if (action === 'accuse') {
    const suspSuspect = getTopSuspect(bot.id, others);
    const suspScore = (_suspicionMap[bot.id]||{})[suspSuspect?.id] ?? 10;
    if (suspSuspect && suspScore > 20) {
      suspect = suspSuspect; // Tố cáo người đang bị nghi nhất
    } else {
      // Chưa đủ bằng chứng → tố cáo người nói nhiều nhất (heuristic)
      const mostActive = [...others].sort((a,b)=>(msgCountByPlayer[b.id]||0)-(msgCountByPlayer[a.id]||0));
      suspect = mostActive[0] || null;
    }
  } else {
    // Cho hint/react/defend: suspect không quan trọng, chọn ngẫu nhiên
    const mostActive = [...others].sort((a,b)=>(msgCountByPlayer[b.id]||0)-(msgCountByPlayer[a.id]||0));
    suspect = mostActive.length ? randItem(mostActive.slice(0, Math.min(2, mostActive.length))) : null;
  }

  const _isBB = S.isBotBattle;
  if (_isBB) setBotSpeaking(bot.id,true); else setAvatarSpeaking(bot.id,true);
  try {
    const text=await callGAS({
      action, botName:bot.name, word, isSpy,
      wordA:room.round?.wordA, wordB:room.round?.wordB,
      recentChat, suspectName:suspect?.name||'',
      players:others.map(p=>p.name)
    });
    if (_isBB) showBotBubble(bot.id,text,5000); else showBubble(bot.id,text,5000);
    postBotChat(bot,text);
    // Cập nhật suspicion map — bot vừa nói, tất cả người khác quan sát
    // (startChatListener cũng làm điều này khi nhận Firebase event,
    //  nhưng gọi trực tiếp ở đây để đảm bảo không bị delay)
    updateSuspicion(
      bot.id, action, text,
      suspect?.id || null,
      players.map(p=>p.id),
      room.round
    );
    // Nếu là accuse: bot đang tố cáo suspect → bot tự tăng suspicion với suspect
    if (action === 'accuse' && suspect) {
      if (!_suspicionMap[bot.id]) _suspicionMap[bot.id] = {};
      const cur = _suspicionMap[bot.id][suspect.id] ?? 10;
      _suspicionMap[bot.id][suspect.id] = Math.min(100, cur + 15);
    }
  } catch(e){
    const sn=suspect?.name||'';
    const sname=sn?sn:'người đó';
    const fallbacks={
      hint: isSpy
        ? ['Ờ tôi hiểu từ này...','Quen quen...','Tôi biết mà']
        : ['Rõ ràng quá còn gì','Tôi chắc 100%','Không cần đoán nhiều'],
      accuse: sn
        ? [sname+' nói cứ sai sai','Tôi thấy '+sname+' mơ hồ lắm',sname+' không tự tin gì cả','Nhìn vào '+sname+' đi mọi người']
        : ['Có người đang nói mơ hồ lắm','Ai đó không biết từ này rõ'],
      defend: isSpy
        ? ['Oan tôi quá!','Tôi biết từ mà, đừng nghi','Sao lại nhìn tôi vậy','Không phải tôi đâu nha']
        : ['Tôi biết từ này chắc như đinh','Nghi oan tôi rồi!','Tôi dân thường 100%','Mọi người nhầm rồi'],
      react: ['Đúng đúng!','Ờ cũng có lý','Hmm đáng ngờ thật','Tôi cũng thấy vậy','Lạ nhỉ...'],
    };
    const list=fallbacks[action]||fallbacks.hint;
    const fbText=randItem(list);
    if (_isBB) showBotBubble(bot.id,fbText,4000); else showBubble(bot.id,fbText,4000);
    postBotChat(bot,fbText);
  }
  setTimeout(()=>{ if (_isBB) setBotSpeaking(bot.id,false); else setAvatarSpeaking(bot.id,false); },5500);
}

async function callGAS(payload) {
  const resp=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(payload)});
  if(!resp.ok) throw new Error('GAS '+resp.status);
  const data=await resp.json();
  return data.text?.trim()||'...';
}

async function getBotVoteTarget(bot, room) {
  const players=Object.values(room.players||{});
  const candidates=players.filter(p=>p.id!==bot.id&&!p.eliminated);
  if(!candidates.length) return null;
  try {
    const chatSnap=await get(ref(db,`rooms/${S.roomId}/chat`));
    let chatHistory='';
    if(chatSnap.exists()){
      const msgs=Object.values(chatSnap.val()).sort((a,b)=>a.ts-b.ts).slice(-10);
      chatHistory=msgs.map(m=>`${m.name}: ${m.text||m.reaction||''}`).join('\n');
    }
    const isSpy=bot.id===room.round?.spyId;
    const myWord=isSpy?room.round?.wordB:room.round?.wordA;
    // Serialize suspicion scores của bot này về từng candidate
    const suspicionScores = {};
    const botSusp = _suspicionMap[bot.id] || {};
    candidates.forEach(p => {
      suspicionScores[p.name] = Math.round(botSusp[p.id] ?? 10);
    });
    const result=await callGAS({
      action:'vote', botName:bot.name, myWord, isSpy,
      wordA:room.round?.wordA, wordB:room.round?.wordB,
      candidates:candidates.map(p=>p.name),
      chatHistory, suspicionScores
    });
    const target=candidates.find(p=>p.name===result?.trim());
    return target?.id||randItem(candidates).id;
  } catch(e){
    return randItem(candidates).id;
  }
}

// ------------------------------------------------
//  CHAT
// ------------------------------------------------
const REACTIONS=['😂','🤔','😱','👀','🤥','✅'];

function startChatListener() {
  // Hủy listener cũ nếu có
  if(S.chatListener){S.chatListener();}
  const r=chatRef();
  const msgs=document.getElementById('chat-messages');
  if(msgs) msgs.innerHTML='';
  // Chỉ hiện tin từ đầu vòng hiện tại
  const cutoff=_lastRoom?.round?.chatStartTs||_lastRoom?.round?.discussStartAt||0;
  let _renderedIds=new Set();

  // onValue() trong Firebase v10 trả về hàm unsubscribe trực tiếp
  const unsubscribe=onValue(r,snap=>{
    if(!snap.exists()) return;
    const sorted=Object.values(snap.val()||{}).sort((a,b)=>a.ts-b.ts);
    const fresh=sorted.filter(m=>{
      if((m.ts||0)<cutoff) return false;
      const id=m.ts+'_'+(m.uid||m.pid||'');
      if(_renderedIds.has(id)) return false;
      _renderedIds.add(id);
      return true;
    });
    if(!fresh.length) return;
    fresh.forEach(m=>{
      appendChatMsg(m);
      // Bot battle: mỗi tin nhắn mới → tất cả bot cập nhật suspicion về người nói
      if(S.isBotBattle && m.pid && m.text && _lastRoom) {
        const allPlayers = Object.values(_lastRoom.players||{});
        const allIds = allPlayers.map(p=>p.id);
        // Đoán actionType từ nội dung chat (heuristic)
        let actionType = 'hint';
        const t = (m.text||'').toLowerCase();
        if (/nghi|tố|đó là|chắc chắn|rõ ràng là/.test(t) && allPlayers.some(p=>p.name&&t.includes(p.name.toLowerCase()))) actionType = 'accuse';
        else if (/oan|không phải tôi|tôi biết|mình biết|bào chữa|sai rồi/.test(t)) actionType = 'defend';
        else if (t.split(/\s+/).length < 5) actionType = 'react';

        // Tìm targetId nếu là accuse
        let targetId = null;
        if (actionType === 'accuse') {
          const mentioned = allPlayers.find(p => p.id !== m.pid && p.name && t.includes(p.name.toLowerCase()));
          if (mentioned) targetId = mentioned.id;
        }
        updateSuspicion(m.pid, actionType, m.text, targetId, allIds, _lastRoom.round);
      }
    });
    if(msgs) msgs.scrollTop=msgs.scrollHeight;
    if(S.chatCollapsed){
      S.chatUnread+=fresh.length;
      const badge=document.getElementById('chat-unread-badge');
      if(badge){badge.textContent=S.chatUnread>9?'9+':S.chatUnread;badge.classList.add('show');}
    }
  });
  S.chatListener=()=>{unsubscribe();S.chatListener=null;}
}

function appendChatMsg(m) {
  const msgs=document.getElementById('chat-messages');
  if(!msgs) return;
  const isMe=m.pid===S.playerId;
  const div=document.createElement('div');
  div.className='chat-msg'+(isMe?' mine':'');
  const emoji=m.isBot?'🤖':'😊';
  div.innerHTML=`
    <div class="chat-msg-avatar">${emoji}</div>
    <div class="chat-msg-body">
      <div class="chat-msg-name">${esc(m.name)}</div>
      ${m.reaction
        ?`<div class="chat-msg-reaction">${m.reaction}</div>`
        :`<div class="chat-msg-text">${esc(m.text||'')}</div>`}
    </div>`;
  msgs.appendChild(div);

  // Also show bubble on avatar
  if(m.text) showBubble(m.pid, m.text.length>40?m.text.slice(0,40)+'…':m.text, 4000);
  if(m.reaction) showBubble(m.pid, m.reaction, 2500);
}

async function postBotChat(bot,text) {
  try {
    const msgId=genId();
    await set(ref(db,`rooms/${S.roomId}/chat/${msgId}`),{
      pid:bot.id, name:bot.name, text, isBot:true, ts:Date.now()
    });
  } catch(e){}
}

async function doSendChat(e) {
  if(e&&e.key&&e.key!=='Enter') return;
  const inp=document.getElementById('chat-inp');
  const text=inp?.value.trim(); if(!text) return;
  inp.value='';
  try {
    const msgId=genId();
    await set(ref(db,`rooms/${S.roomId}/chat/${msgId}`),{
      pid:S.playerId, name:S.playerName, text, isBot:false, ts:Date.now()
    });
  } catch(e){console.error(e);}
}

async function doSendReaction(emoji) {
  try {
    const msgId=genId();
    await set(ref(db,`rooms/${S.roomId}/chat/${msgId}`),{
      pid:S.playerId, name:S.playerName, reaction:emoji, isBot:false, ts:Date.now()
    });
  } catch(e){}
}

function toggleChat() {
  S.chatCollapsed=!S.chatCollapsed;
  document.querySelector('.chat-panel')?.classList.toggle('collapsed',S.chatCollapsed);
  if(!S.chatCollapsed){
    S.chatUnread=0;
    const badge=document.getElementById('chat-unread-badge');
    if(badge) badge.classList.remove('show');
    const msgs=document.getElementById('chat-messages');
    if(msgs) setTimeout(()=>{msgs.scrollTop=msgs.scrollHeight;},100);
  }
}

// ------------------------------------------------
//  TIME-UP VOTING
// ------------------------------------------------
async function doTimeUpVoting() {
  if(S.timerInterval) clearInterval(S.timerInterval);
  S.timerRunning=false;
  _botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];

  // Bot battle: tính vote ngay trên client (observer là người duy nhất theo dõi)
  if (S.isBotBattle) {
    try {
      const snap = await get(roomRef());
      const roomData = snap.val();
      if (!roomData || roomData.status !== 'discussing') return;
      const players = Object.values(roomData.players||{});
      // Thu thập vote thông minh từ suspicion map
      const botVotes = {};
      players.filter(p=>p.isBot&&!p.eliminated).forEach(bot=>{
        const candidates = players.filter(p=>p.id!==bot.id&&!p.eliminated);
        if (!candidates.length) return;
        const topSusp = getTopSuspect(bot.id, candidates);
        botVotes[bot.id] = topSusp ? topSusp.id : randItem(candidates).id;
      });
      await runTransaction(roomRef(), room => {
        if (!room || room.status !== 'discussing') return room;
        room.status = 'voting';
        room.round.votes = {...(room.round.earlyVotes||{})};
        delete room.round.earlyVotes;
        // Ghi vote của tất cả bot vào transaction
        Object.keys(botVotes).forEach(bid => {
          room.round.votes[bid] = botVotes[bid];
        });
        // Nếu tất cả đã vote → resolve ngay
        const active = Object.values(room.players).filter(p=>!p.eliminated);
        if (active.every(p => room.round.votes[p.id])) resolveVotesTx(room);
        else room.round.voteDeadline = Date.now()+8000;
        return room;
      });
      _autoBotVoteDone = true; // đánh dấu đã vote để handleBotBattleFlow không gọi lại
      console.log('doTimeUpVoting BB OK:', botVotes);
    } catch(e) { console.error('doTimeUpVoting BB', e); }
    return;
  }

  // Normal game: chỉ host gọi GAS
  const roomSnap=await get(roomRef()).catch(()=>null);
  const roomData=roomSnap?.val()||null;
  const botVotes={};
  if(roomData && roomData.hostId===S.playerId){
    const bots=Object.values(roomData.players||{}).filter(p=>p.isBot&&!p.eliminated);
    await Promise.all(bots.map(async bot=>{
      const t=await getBotVoteTarget(bot,roomData);
      if(t) botVotes[bot.id]=t;
    }));
  }
  try {
    await runTransaction(roomRef(),room=>{
      if(!room||room.status!=='discussing') return room;
      room.status='voting';
      room.round.votes={...(room.round.earlyVotes||{})};
      delete room.round.earlyVotes;
      const players=Object.values(room.players||{});
      players.filter(p=>p.isBot&&!p.eliminated).forEach(bot=>{
        const others=players.filter(p=>p.id!==bot.id&&!p.eliminated);
        room.round.votes[bot.id]=botVotes[bot.id]||(others.length?randItem(others).id:null);
      });
      room.round.voteDeadline=Date.now()+10000;
      return room;
    });
  } catch(e){console.error(e);}
}

// ------------------------------------------------
//  VOTE SCREEN (overlay style, 10s timer)
// ------------------------------------------------
function renderVote(room) {
  S.selectedVote=null;
  const players=room.playerList||Object.values(room.players||{});
  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;
  // Người đã vote sớm thì đánh dấu đã vote, không cần vote lại
  const alreadyEarlyVoted=!!(room.round?.votes?.[S.playerId]);
  if(alreadyEarlyVoted) S.votedThisRound=true;
  const grid=document.getElementById('vote-grid');
  grid.innerHTML='';

  if(iAmEliminated){
    document.getElementById('btn-confirm-vote').style.display='none';
    document.getElementById('vote-waiting').style.display='none';
    renderSpectatorVotes(room);
  } else if(alreadyEarlyVoted){
    // Đã vote sớm — chỉ hiện trạng thái chờ
    document.getElementById('btn-confirm-vote').style.display='none';
    document.getElementById('vote-waiting').style.display='block';
    document.getElementById('vote-waiting').textContent='✓ Đã bỏ phiếu — đang chờ';
  } else {
    document.getElementById('btn-confirm-vote').style.display='';
    document.getElementById('btn-confirm-vote').disabled=true;
    document.getElementById('vote-waiting').style.display='none';
    players.filter(p=>!p.eliminated).forEach(p=>{
      const btn=document.createElement('button');
      btn.className='vote-opt';
      btn.textContent=(p.isBot?'🤖 ':'')+p.name+(p.id===S.playerId?' (bạn)':'');
      btn.onclick=()=>{
        document.querySelectorAll('#vote-grid .vote-opt').forEach(b=>b.classList.remove('sel'));
        btn.classList.add('sel'); S.selectedVote=p.id;
        document.getElementById('btn-confirm-vote').disabled=false;
      };
      grid.appendChild(btn);
    });
    const ab=document.createElement('button');
    ab.className='vote-opt abstain'; ab.textContent='Bỏ phiếu trắng';
    ab.onclick=()=>{
      document.querySelectorAll('#vote-grid .vote-opt').forEach(b=>b.classList.remove('sel'));
      ab.classList.add('sel'); S.selectedVote='abstain';
      document.getElementById('btn-confirm-vote').disabled=false;
    };
    grid.appendChild(ab);
  }
  updateVoteStatus(room);
}

function startVoteTimer(room) {
  if(S.voteTimerInterval) clearInterval(S.voteTimerInterval);
  const deadline=room.round?.voteDeadline||(Date.now()+10000);
  function tick(){
    const rem=Math.max(0,Math.ceil((deadline-Date.now())/1000));
    const el=document.getElementById('vote-timer-display');
    if(el){el.textContent=rem;el.style.color=rem<=3?'var(--red)':'var(--cream)';}
    if(rem===0){clearInterval(S.voteTimerInterval);if(!S.votedThisRound){S.selectedVote='abstain';doVote();}}
  }
  tick(); S.voteTimerInterval=setInterval(tick,500);
}

function renderSpectatorVotes(room) {
  const players=room.playerList||Object.values(room.players||{});
  const vc={};
  players.forEach(p=>{vc[p.id]=0;});
  Object.values(room.round?.votes||{}).forEach(id=>{if(id&&id!=='abstain'&&vc[id]!==undefined)vc[id]++;});
  const maxV=Math.max(1,...Object.values(vc));
  const grid=document.getElementById('vote-grid');
  grid.style.gridTemplateColumns='1fr';
  grid.innerHTML=`
    <div style="grid-column:1/-1;text-align:center;font-family:'Bebas Neue';letter-spacing:.2em;font-size:.8rem;color:var(--red);opacity:.7;padding:6px 0;">👻 BẠN ĐÃ BỊ LOẠI — ĐANG XEM</div>
    ${players.filter(p=>!p.eliminated).map(p=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--gray2);border:1px solid var(--gray3);">
        <div style="flex:1"><div>${p.isBot?'🤖 ':''}${esc(p.name)}</div>
        <div style="height:3px;background:var(--red);margin-top:5px;width:${(vc[p.id]/maxV)*100}%;transition:width .4s"></div></div>
        <div style="font-family:'Bebas Neue';font-size:1.4rem;color:var(--red)">${vc[p.id]}</div>
      </div>`).join('')}`;
}

function updateVoteStatus(room) {
  const players=room.playerList||Object.values(room.players||{});
  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;
  const humans=players.filter(p=>!p.isBot&&!p.eliminated);
  const voted=humans.filter(p=>room.round?.votes?.[p.id]).length;
  const el=document.getElementById('vote-status-text');
  if(el) el.textContent=`${voted}/${humans.length} người đã bỏ phiếu`;
  if(iAmEliminated){renderSpectatorVotes(room);return;}
  if(S.votedThisRound){
    document.getElementById('btn-confirm-vote').style.display='none';
    document.getElementById('vote-waiting').style.display='block';
  }
}

async function doVote() {
  const choice=S.selectedVote||'abstain';
  if(!S.selectedVote) toast('⏰ Hết giờ — tự bỏ phiếu trắng');
  if(S.votedThisRound) return;
  S.votedThisRound=true; loading(true);
  try {
    await runTransaction(roomRef(),room=>{
      if(!room||room.status!=='voting') return room;
      room.round.votes[S.playerId]=choice;
      const players=Object.values(room.players||{});
      const humans=players.filter(p=>!p.isBot&&!p.eliminated);
      if(humans.every(p=>room.round.votes[p.id])) resolveVotesTx(room);
      return room;
    });
  } catch(e){toast('Lỗi: '+e.message);console.error(e);S.votedThisRound=false;}
  finally{loading(false);}
}

// ------------------------------------------------
//  RESOLVE VOTES
// ------------------------------------------------
function resolveVotesTx(room) {
  const players=Object.values(room.players||{});
  const vc={};
  players.forEach(p=>{vc[p.id]=0;});
  Object.values(room.round.votes||{}).forEach(id=>{if(id&&id!=='abstain'&&vc[id]!==undefined)vc[id]++;});
  const maxV=Math.max(0,...Object.values(vc));
  const topIds=Object.entries(vc).filter(([,cnt])=>cnt===maxV).map(([id])=>id);
  room.round.voteCounts=vc;

  if(maxV===0||topIds.length>1){
    room.round.isTie=true; room.round.eliminatedId=null; room.round.eliminatedName=null;
    room.round._nextStatus='discussing'; room.status='votesummary'; return;
  }
  room.round.isTie=false;
  const mostId=topIds[0];
  room.round.mostVotedId=mostId; room.round.eliminatedId=mostId;
  const eliminated=room.players[mostId];
  room.round.eliminatedName=eliminated?.name||'?';
  if(eliminated) eliminated.eliminated=true;

  if(mostId===room.round.spyId){
    const spy=room.players[room.round.spyId];
    if(spy?.isBot){
      room.round.spyGuess='???'; room.round.result='villagers';
      players.filter(p=>p.id!==room.round.spyId).forEach(p=>{p.score=(p.score||0)+1;});
      room.round._nextStatus='result';
    } else { room.round._nextStatus='spyguess'; }
  } else {
    const active=players.filter(p=>!p.eliminated);
    // Tất cả người còn sống không phải gián điệp (kể cả bot)
    const nonSpy=active.filter(p=>p.id!==room.round.spyId);
    // Chỉ người thật không phải gián điệp (để xét điểm)
    const humanVillagers=active.filter(p=>p.id!==room.round.spyId&&!p.isBot);
    const spy=room.players[room.round.spyId];
    // Gián điệp thắng khi số người còn lại (kể cả bot) <= 1
    if(nonSpy.length<=1){
      room.round.result='spy'; room.round._nextStatus='result';
      if(spy) spy.score=(spy.score||0)+2;
    } else { room.round._nextStatus='discussing'; }
  }
  room.status='votesummary';
}

// ------------------------------------------------
//  VOTE SUMMARY
// ------------------------------------------------
let _summaryTimer=null;

function showVoteSummary(room) {
  const rd=room.round, players=room.playerList||Object.values(room.players||{});
  const vc=rd.voteCounts||{}, isTie=rd.isTie||false;
  document.getElementById('vs-eliminated-box').style.display=isTie?'none':'';
  document.getElementById('vs-tie-box').style.display=isTie?'':'none';
  if(!isTie&&rd.eliminatedName) document.getElementById('vs-eliminated-name').textContent=rd.eliminatedName;
  const maxV=Math.max(1,...Object.values(vc).map(Number));
  document.getElementById('vs-vote-list').innerHTML=[...players]
    .sort((a,b)=>(vc[b.id]||0)-(vc[a.id]||0))
    .map(p=>`<div class="vr-row" style="${p.id===rd.eliminatedId?'border-color:var(--red);background:rgba(192,57,43,.08)':''}">
      <div style="flex:1"><div>${p.isBot?'🤖 ':''}${esc(p.name)}${p.eliminated&&p.id!==rd.eliminatedId?' ❌':''}</div>
      <div class="vr-bar" style="width:${((vc[p.id]||0)/maxV)*100}%"></div></div>
      <div class="vr-count">${vc[p.id]||0}</div></div>`).join('');
  if(_summaryTimer) clearInterval(_summaryTimer);
  let cd=4;
  document.getElementById('vs-countdown').textContent=`Tiếp tục sau ${cd} giây`;
  _summaryTimer=setInterval(()=>{
    cd--;
    if(cd>0) document.getElementById('vs-countdown').textContent=`Tiếp tục sau ${cd} giây`;
    else { clearInterval(_summaryTimer); advanceAfterSummary(); }
  },1000);
  nav('votesummary',{room:S.roomId});
}

async function advanceAfterSummary() {
  await runTransaction(roomRef(),room=>{
    if(!room||room.status!=='votesummary') return room;
    room.status=room.round._nextStatus||'discussing';
    delete room.round._nextStatus;
    if(room.status==='discussing'){
      room.round.discussStartAt=Date.now();
      if(!room.round.isTie) room.round.chatStartTs=Date.now();
      room.round.discussDuration=room.round.isTie?45:90;
      room.round.votes={}; room.round.voteCounts={}; room.round.isTie=false;
    }
    return room;
  });
}

// ------------------------------------------------
//  SPY GUESS
// ------------------------------------------------
function showSpyGuess(room) {
  const players=room.playerList||Object.values(room.players||{});
  const spy=players.find(p=>p.id===room.round.spyId);
  document.getElementById('sg-spy-name').textContent=(spy?.isBot?'🤖 ':'')+(spy?.name||'Gián Điệp');
  const iAmSpy=room.round.spyId===S.playerId;
  document.getElementById('sg-input-area').style.display=iAmSpy?'flex':'none';
  document.getElementById('sg-waiting').style.display=iAmSpy?'none':'block';
  document.getElementById('sg-input').value=''; S.spyGuessSubmitted=false;
  nav('spyguess',{room:S.roomId});
}

async function doSpyGuess() {
  const guess=document.getElementById('sg-input').value.trim();
  if(!guess){toast('Nhập đáp án!');return;}
  if(S.spyGuessSubmitted) return;
  S.spyGuessSubmitted=true; loading(true);
  try {
    await runTransaction(roomRef(),room=>{
      if(!room||room.status!=='spyguess') return room;
      if(room.round.spyId!==S.playerId) return room;
      const ans=room.round.wordA.toLowerCase(), g=guess.trim().toLowerCase();
      const correct=g===ans||ans.includes(g)||g.includes(ans);
      const players=Object.values(room.players||{});
      room.round.spyGuess=guess;
      if(correct){room.round.result='spy';const spy=room.players[room.round.spyId];if(spy)spy.score=(spy.score||0)+3;}
      else{room.round.result='villagers';players.filter(p=>p.id!==room.round.spyId).forEach(p=>{p.score=(p.score||0)+1;});}
      room.status='result'; return room;
    });
  } catch(e){toast('Lỗi: '+e.message);console.error(e);S.spyGuessSubmitted=false;}
  finally{loading(false);}
}

// ════════════════════════════════════════════════
//  LEARN — gửi kết quả ván lên GAS để bot học
// ════════════════════════════════════════════════
async function sendLearnPayload(room) {
  try {
    const rd = room.round;
    const players = room.playerList || Object.values(room.players || {});
    const bots = players.filter(p => p.isBot);
    if (!bots.length) return;

    // Đọc chat của ván này
    const chatSnap = await get(ref(db, 'rooms/' + S.roomId + '/chat')).catch(() => null);
    const allMsgs = chatSnap?.val()
      ? Object.values(chatSnap.val()).sort((a, b) => a.ts - b.ts)
      : [];
    const cutoff = rd.chatStartTs || rd.discussStartAt || 0;
    const roundMsgs = allMsgs.filter(m => (m.ts || 0) >= cutoff);

    const gameId = S.roomId + '_' + (room.roundNumber || 0);

    const botsPayload = bots.map(bot => {
      const isSpy = bot.id === rd.spyId;
      const won = rd.result === (isSpy ? 'spy' : 'villagers');
      const word = isSpy ? rd.wordB : rd.wordA;

      // Tất cả tin bot đã gửi trong ván
      const botMsgs = roundMsgs.filter(m => m.pid === bot.id && m.text);
      // actions: dùng text của bot, type suy ra từ nội dung (đơn giản: mọi tin = hint)
      // GAS sẽ tự đánh giá đúng hơn dựa trên context
      const actions = botMsgs.map(m => ({ type: 'hint', text: m.text, ts: m.ts }));

      // Bot vote ai
      const votedFor = rd.votes?.[bot.id] || null;
      const votedForName = votedFor ? (players.find(p => p.id === votedFor)?.name || votedFor) : null;

      // Ai vote bot
      const wasVotedBy = Object.entries(rd.votes || {})
        .filter(([pid, tid]) => tid === bot.id)
        .map(([pid]) => players.find(p => p.id === pid)?.name || pid);

      return {
        botName: bot.name,
        role: isSpy ? 'spy' : 'villager',
        won, word,
        wordA: rd.wordA, wordB: rd.wordB,
        actions,
        votedFor: votedForName,
        wasVotedBy,
        spyId: rd.spyId
      };
    });

    // Gửi async, không chặn UI
    callGAS({ action: 'learn', gameId, bots: botsPayload }).catch(() => {});
  } catch(e) {
    console.warn('sendLearnPayload error:', e);
  }
}

// ------------------------------------------------
//  RESULT
// ------------------------------------------------
function showResult(room) {
  const rd=room.round, players=room.playerList||Object.values(room.players||{});
  const isWin=rd.result==='villagers';
  document.getElementById('result-banner').textContent=isWin?'🎉 DÂN THƯỜNG THẮNG!':'🕵️ GIÁN ĐIỆP THẮNG!';
  document.getElementById('result-banner').className='result-banner '+(isWin?'win':'lose');
  document.getElementById('res-word-a').textContent=rd.wordA||'—';
  document.getElementById('res-word-b').textContent=rd.wordB||'—';
  const spy=players.find(p=>p.id===rd.spyId);
  document.getElementById('res-spy').textContent=(spy?.isBot?'🤖 ':'')+(spy?.name||'—');
  const vc=rd.voteCounts||{}, maxV=Math.max(1,...Object.values(vc).map(Number));
  document.getElementById('res-votes').innerHTML=players.map(p=>`
    <div class="vr-row"><div style="flex:1">
      <div>${p.isBot?'🤖 ':''}${esc(p.name)}${p.id===rd.spyId?' 🕵️':''}${p.eliminated?' ❌':''}</div>
      <div class="vr-bar" style="width:${((vc[p.id]||0)/maxV)*100}%"></div>
    </div><div class="vr-count">${vc[p.id]||0}</div></div>`).join('');
  document.getElementById('res-scores').innerHTML=[...players].sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`
    <tr><td>${p.isBot?'🤖 ':''}${esc(p.name)}${p.id===S.playerId?' <span style="color:var(--green);font-size:.75em">(bạn)</span>':''}</td>
    <td>${p.score||0} điểm</td></tr>`).join('');
  document.getElementById('btn-next-round').style.display=room.hostId===S.playerId?'inline-flex':'none';
  nav('result',{room:S.roomId});
  // Gửi kết quả ván để bot học — chỉ host gửi tránh duplicate
  if (room.hostId === S.playerId) sendLearnPayload(room);
}

// ------------------------------------------------
//  NEXT ROUND / LEAVE
// ------------------------------------------------
async function doNextRound() {
  loading(true);
  try {
    await runTransaction(roomRef(),room=>{
      if(!room||room.status!=='result') return room;
      room.status='waiting';
      Object.values(room.players||{}).forEach(p=>{p.ready=!!p.isBot;p.eliminated=false;p.cardConfirmed=false;});
      room.round={votes:{},voteCounts:{},spyGuess:null,result:null};
      return room;
    });
    // Side effects sau transaction
    S.myWord=null; _wordPickedUp=false; save();
  } catch(e){toast('Lỗi: '+e.message);console.error(e);}
  finally{loading(false);}
}

async function doLeave() {
  stopListening();
  removeBotBattleOverlay();
  if(S.timerInterval) clearInterval(S.timerInterval);
  if(S.voteTimerInterval) clearInterval(S.voteTimerInterval);
  if(_summaryTimer) clearInterval(_summaryTimer);
  if(_botBattleAdvanceTimer){clearTimeout(_botBattleAdvanceTimer);_botBattleAdvanceTimer=null;}
  _botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];
  clearBotActionLog();
  const{roomId,playerId}=S;
  S.roomId=''; S.playerId=''; S.playerName=''; S.myWord=null;
  S.earlyVoted=false; S.earlyVoteChoice=null; S.votedThisRound=false;
  S._inDiscussion=false; S.timerRunning=false;
  try{localStorage.removeItem('gd_fb1');}catch(e){}
  if(roomId&&playerId){
    try {
      await runTransaction(ref(db,`rooms/${roomId}`),room=>{
        if(!room) return room;
        delete room.players?.[playerId];
        const rem=Object.values(room.players||{});
        if(!rem.length) return null;
        if(room.hostId===playerId) room.hostId=rem.find(p=>!p.isBot)?.id||rem[0].id;
        return room;
      });
    } catch(e){}
  }
  nav('home');
}

// ------------------------------------------------
//  INIT
// ------------------------------------------------
load();
const{screen:initScreen,params:initParams}=parseHash();
showScreen(initScreen);
if(initScreen==='join'&&initParams.room){
  const el=document.getElementById('join-code'); if(el) el.value=initParams.room;
}
if(S.roomId&&S.playerId&&!['home','create','join','rules'].includes(initScreen)) listenRoom(S.roomId);

// Build reaction picker
const rp=document.getElementById('reaction-picker');
if(rp) REACTIONS.forEach(e=>{
  const btn=document.createElement('button');
  btn.className='reaction-btn'; btn.textContent=e;
  btn.onclick=()=>doSendReaction(e);
  rp.appendChild(btn);
});


// ================================================
//  BOT BATTLE — Phòng toàn bot tự đấu
// ================================================
let _suspicionMap = {};

function initSuspicion(players) {
  _suspicionMap = {};
  players.forEach(a => {
    _suspicionMap[a.id] = {};
    players.forEach(b => {
      if (a.id !== b.id) _suspicionMap[a.id][b.id] = 10;
    });
  });
}

function updateSuspicion(speakerId, actionType, text, targetId, allPlayerIds, round) {
  if (!text || !speakerId) return;
  const lower  = (text || '').toLowerCase();
  const wordB  = (round?.wordB || '').toLowerCase(); // từ của spy
  const wordA  = (round?.wordA || '').toLowerCase(); // từ của dân

  // Tất cả người quan sát (không phải chính người nói) cập nhật nghi ngờ về người nói
  allPlayerIds.forEach(observerId => {
    if (observerId === speakerId) return;
    if (!_suspicionMap[observerId]) _suspicionMap[observerId] = {};
    let delta = 0;

    if (actionType === 'hint') {
      const wc = text.trim().split(/\s+/).length;
      // Câu quá ngắn (< 4 từ) → mơ hồ → nghi hơn
      if (wc < 4)  delta += 12;
      // Câu vừa đủ, tự nhiên → ít nghi hơn
      if (wc >= 5 && wc <= 10) delta -= 5;
      // Câu quá dài → có thể đang nói quá nhiều để che đậy
      if (wc > 14) delta += 6;
      // Dùng từ của spy → rất đáng nghi
      if (wordB && lower.includes(wordB)) delta += 40;
      // Mô tả cụ thể, rõ ràng (dân thường hay làm vậy) → ít nghi
      if (/(thường|hay|dùng để|màu|hình|mùi|vị|cảm giác|dành cho|trông như|giống như)/i.test(text)) delta -= 8;
      // Nói mơ hồ kiểu spy → nghi hơn
      if (/(ừ|ờ|biết rồi|tôi hiểu|tôi biết|đúng vậy|có lý)/i.test(text)) delta += 10;
      // Nếu hint không liên quan từ khoá dân (heuristic: không chứa bất kỳ từ gợi ý nào)
    }

    if (actionType === 'accuse') {
      // Người hay tố cáo → có thể đang cố đánh lạc hướng (spy tactic)
      delta += 4;
    }

    if (actionType === 'defend') {
      // Người đang bào chữa → giảm nghi với người khác (họ đang tự bảo vệ)
      delta -= 8;
      // Nhưng nếu bào chữa nhắc từ của spy → rất đáng nghi
      if (wordB && lower.includes(wordB)) delta += 35;
      // Bào chữa rất tự tin, logic → dân thường hay làm vậy
      if (/(rõ ràng|chứng minh|logic|tôi đã|mình đã)/i.test(text)) delta -= 5;
    }

    if (actionType === 'react') {
      // React ngắn, vô nghĩa → hơi đáng nghi
      if (text.trim().split(/\s+/).length < 3) delta += 5;
    }

    const cur = _suspicionMap[observerId][speakerId] ?? 10;
    _suspicionMap[observerId][speakerId] = Math.max(0, Math.min(100, cur + delta));
  });

  // Nếu ai đó tố cáo X → những người quan sát cũng tăng nghi ngờ về X một chút
  if (actionType === 'accuse' && targetId) {
    allPlayerIds.forEach(observerId => {
      if (observerId === speakerId || observerId === targetId) return;
      if (!_suspicionMap[observerId]) _suspicionMap[observerId] = {};
      const cur = _suspicionMap[observerId][targetId] ?? 10;
      _suspicionMap[observerId][targetId] = Math.max(0, Math.min(100, cur + 8));
    });
    // Người bị tố cáo cũng tăng nghi ngờ về người tố cáo (có thể spy đang chuyển hướng)
    if (_suspicionMap[targetId]) {
      const cur = _suspicionMap[targetId][speakerId] ?? 10;
      _suspicionMap[targetId][speakerId] = Math.max(0, Math.min(100, cur + 6));
    }
  }
}

function getTopSuspect(botId, candidates) {
  const scores = _suspicionMap[botId] || {};
  // Tính score + thêm nhiễu nhỏ để các bot không vote y hệt nhau
  const ranked = candidates.map(p => ({
    player: p,
    score: (scores[p.id] ?? 10) + Math.random() * 5
  })).sort((a,b) => b.score - a.score);

  const top = ranked[0];
  // Chỉ vote chắc chắn nếu suspicion > 25 (đã quan sát đủ hành vi đáng nghi)
  if (top && top.score > 25) return top.player;
  // Nếu chưa đủ bằng chứng → chọn ngẫu nhiên trong top 2 (không biết ai)
  const pool = ranked.slice(0, Math.min(2, ranked.length));
  return pool[Math.floor(Math.random() * pool.length)]?.player || null;
}

function serializeSuspicion(botId, players) {
  const scores = _suspicionMap[botId] || {};
  return players
    .filter(p => p.id !== botId)
    .map(p => `${p.name}:${Math.round(scores[p.id] ?? 10)}`)
    .join(',');
}

async function doCreateBotBattle() {
  const maxRoundsEl = document.getElementById('bot-battle-rounds');
  const maxRounds   = maxRoundsEl ? (parseInt(maxRoundsEl.value)||10) : 10;
  loading(true);
  try {
    await cleanOldRooms();
    let roomId, exists;
    do { roomId=genRoomCode(); exists=(await get(roomRef(roomId))).exists(); } while(exists);

    const observerId = 'obs_' + genId();
    S.roomId=roomId; S.playerId=observerId; S.playerName='👁 Observer';
    S.myWord=null; S.isBotBattle=true; S.isObserver=true;
    save();

    const kw = await getKeywords();

    // Lấy bot roster từ GAS để có đúng tên + avatarUrl đã cài
    const players = {};
    const usedNames = [];
    for (let i = 0; i < 5; i++) {
      try {
        const resp = await fetch(GAS_URL, {
          method: 'POST',
          headers: {'Content-Type':'text/plain'},
          body: JSON.stringify({ action:'bot_roster', usedNames })
        });
        const data = await resp.json();
        const botId = 'bot_' + genId();
        const name  = data.name || ('Bot '+(i+1));
        usedNames.push(name);
        players[botId] = {
          id: botId, name, ready:true, score:0,
          isBot:true, cardConfirmed:true,
          avatarUrl: data.avatarUrl || ''
        };
      } catch(e) {
        // Fallback nếu GAS lỗi
        const fallbacks = ["Daydream","Kizuna","Anubis","Teth","Daleth","Fire","Water","Air","Melan","Earth"];
        const name = fallbacks.filter(n=>!usedNames.includes(n))[0] || ('Bot '+(i+1));
        usedNames.push(name);
        const botId = 'bot_' + genId();
        players[botId] = { id:botId, name, ready:true, score:0, isBot:true, cardConfirmed:true, avatarUrl:'' };
      }
    }

    await set(roomRef(roomId), {
      id:roomId, createdAt:Date.now(), status:'waiting',
      hostId: Object.keys(players)[0],
      isBotBattle: true,
      botBattleMaxRounds: maxRounds,
      botBattleRoundsDone: 0,
      roundNumber: 0,
      players
    });

    await runTransaction(roomRef(roomId), room => {
      if (!room) return room;
      beginRoundTx(room, kw);
      return room;
    });

    listenRoom(roomId);
    nav('botbattle', {room:roomId});
    toast('🤖 Phòng bot đang chạy...');
  } catch(e) { toast('❌ '+e.message); console.error(e); }
  finally { loading(false); }
}

async function handleBotBattleFlow(room) {
  const status  = room.status;
  const players = room.playerList || Object.values(room.players||{});

  if (status === 'waiting') return;
  if (status === 'playing') { autoBotConfirmCards(room); return; }

  if (status === 'discussing') {
    // Dùng lại y hệt discussion screen bình thường
    if (!S._inDiscussion) {
      startDiscussionScreen(room);
      // Đổi word display thành BOT BATTLE thay vì từ khoá
      const wordEl = document.getElementById('tb-word-display');
      if (wordEl) wordEl.textContent = '🤖 BOT BATTLE';
      // Mở chat ngay (observer muốn xem)
      S.chatCollapsed = false;
      document.querySelector('.chat-panel')?.classList.remove('collapsed');
      // Init suspicion map cho bot battle
      initSuspicion(players);
      // Inject overlay stats vào bàn
      injectBotBattleOverlay(room);
    } else {
      updateTableAvatars(room);
      updateBotBattleOverlay(room);
    }
    return;
  }
  if (status === 'voting') {
    S._inDiscussion = false;
    if (!_autoBotVoteDone) autoBotVote(room);
    return;
  }
  if (status === 'votesummary') {
    S._inDiscussion = false;
    if (!_botBattleAdvanceTimer) {
      _botBattleAdvanceTimer = setTimeout(async () => {
        _botBattleAdvanceTimer = null;
        await advanceAfterSummary();
        // Nếu tie → quay lại discussing, reset state để bot tiếp tục
        _autoBotVoteDone = false;
        _autoBotSpyGuessDone = false;
      }, 4500);
    }
    return;
  }
  if (status === 'spyguess') {
    S._inDiscussion = false;
    autoBotSpyGuess(room);
    return;
  }
  if (status === 'result') {
    S._inDiscussion = false;
    if (!room._learnSent) {
      update(roomRef(), { _learnSent: true }).catch(()=>{});
      sendLearnPayload(room);
    }
    const done = room.botBattleRoundsDone || 0;
    const max  = room.botBattleMaxRounds  || 10;
    if (done < max) {
      if (!_botBattleAdvanceTimer) {
        _botBattleAdvanceTimer = setTimeout(async () => {
          _botBattleAdvanceTimer = null;
          _autoBotVoteDone = false;
          _autoBotSpyGuessDone = false;
          await doNextRoundBotBattle();
        }, 5000);
      }
    }
    return;
  }
}

async function autoBotConfirmCards(room) {
  try {
    await runTransaction(roomRef(), r => {
      if (!r || r.status !== 'playing') return r;
      Object.values(r.players||{}).forEach(p => { p.cardConfirmed = true; });
      if (Object.values(r.players).every(p => p.cardConfirmed)) {
        r.status = 'discussing';
        r.round.discussStartAt = Date.now();
        r.round.chatStartTs    = Date.now();
        delete r._wordAssignments;
      }
      return r;
    });
  } catch(e) { console.error('autoBotConfirmCards', e); }
}

async function autoBotVote(room) {
  if (_autoBotVoteDone) return;
  _autoBotVoteDone = true;
  // Nhỏ delay để Firebase chắc chắn đã set status='voting'
  await new Promise(r => setTimeout(r, 800));
  try {
    const snap = await get(roomRef());
    const freshRoom = snap.val();
    if (!freshRoom || freshRoom.status !== 'voting') {
      console.log('autoBotVote: status not voting yet, skip');
      _autoBotVoteDone = false; return;
    }
    const players = Object.values(freshRoom.players||{});
    const botVotes = {};
    for (const bot of players.filter(p => p.isBot && !p.eliminated)) {
      const candidates = players.filter(p => p.id !== bot.id && !p.eliminated);
      if (!candidates.length) continue;
      const topSusp = getTopSuspect(bot.id, candidates);
      botVotes[bot.id] = topSusp ? topSusp.id : randItem(candidates).id;
    }
    await runTransaction(roomRef(), r => {
      if (!r || r.status !== 'voting') return r;
      Object.keys(botVotes).forEach(bid => {
        if (!r.round.votes[bid]) r.round.votes[bid] = botVotes[bid];
      });
      const active = Object.values(r.players).filter(p => !p.eliminated);
      if (active.every(p => r.round.votes[p.id])) resolveVotesTx(r);
      return r;
    });
    console.log('autoBotVote OK:', botVotes);
  } catch(e) { console.error('autoBotVote', e); _autoBotVoteDone = false; }
}

async function autoBotSpyGuess(room) {
  if (_autoBotSpyGuessDone) return;
  _autoBotSpyGuessDone = true;
  const spyId = room.round?.spyId;
  const spy   = room.players?.[spyId];
  if (!spy?.isBot) return;
  setTimeout(async () => {
    try {
      await runTransaction(roomRef(), r => {
        if (!r || r.status !== 'spyguess') return r;
        const players = Object.values(r.players||{});
        r.round.spyGuess = '???';
        r.round.result   = 'villagers';
        players.filter(p => p.id !== r.round.spyId).forEach(p => { p.score = (p.score||0)+1; });
        r.status = 'result';
        return r;
      });
    } catch(e) { console.error('autoBotSpyGuess', e); }
  }, 2500);
}

async function doNextRoundBotBattle() {
  loading(true);
  try {
    const kw = await getKeywords();
    await runTransaction(roomRef(), room => {
      if (!room || room.status !== 'result') return room;
      room.botBattleRoundsDone = (room.botBattleRoundsDone||0) + 1;
      if (room.botBattleRoundsDone >= (room.botBattleMaxRounds||10)) {
        room.status = 'botbattle_end'; return room;
      }
      Object.values(room.players||{}).forEach(p => {
        p.ready=true; p.eliminated=false; p.cardConfirmed=true;
      });
      room.round  = {votes:{},voteCounts:{},spyGuess:null,result:null};
      room._learnSent = false;
      beginRoundTx(room, kw);
      return room;
    });
    _autoBotVoteDone=false; _autoBotSpyGuessDone=false; S._inDiscussion=false;
  } catch(e){ toast('Lỗi: '+e.message); console.error(e); }
  finally { loading(false); }
}

function renderBotBattleObserver(room) {
  const el = document.getElementById('botbattle-content');
  if (!el) return;
  const players = room.playerList || Object.values(room.players||{});
  const status  = room.status;
  const rd      = room.round || {};
  const done    = room.botBattleRoundsDone || 0;
  const max     = room.botBattleMaxRounds  || 10;

  if (status === 'botbattle_end') { renderBotBattleEnd(room); return; }

  const statusLabel = {
    waiting:'⏳ Chuẩn bị...', playing:'🃏 Chia bài...',
    discussing:'💬 Thảo luận', voting:'🗳️ Bỏ phiếu',
    votesummary:'📊 Kết quả vote', spyguess:'🕵️ Spy đoán từ',
    result:'🏆 Kết quả ván'
  }[status] || status;

  // Suspicion heatmap (chỉ khi discussing)
  let suspHTML = '';
  const hasSusp = status === 'discussing' && Object.keys(_suspicionMap).length > 0;
  if (hasSusp) {
    suspHTML = `<div style="margin-bottom:8px">
      <div style="font-family:'Bebas Neue';font-size:.7rem;letter-spacing:.1em;opacity:.4;margin-bottom:4px">🧠 NGHI NGỜ</div>
      ${players.map(p => {
        const scores = _suspicionMap[p.id] || {};
        const topTarget = players
          .filter(t => t.id !== p.id)
          .sort((a,b) => (scores[b.id]||0) - (scores[a.id]||0))[0];
        if (!topTarget) return '';
        const score = Math.round(scores[topTarget.id] || 0);
        const pct = score / 100;
        const r2 = Math.round(50 + pct*200), g2 = Math.round(180 - pct*180);
        return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:.68rem">
          <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name.split(' ')[0])}</span>
          <span style="opacity:.4">→</span>
          <span style="flex:1;white-space:nowrap;overflow:hidden">${esc(topTarget.name.split(' ')[0])}</span>
          <span style="background:rgb(${r2},${g2},50);color:#fff;padding:1px 4px;border-radius:2px;font-weight:bold">${score}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Scoreboard
  const sorted = [...players].sort((a,b)=>(b.score||0)-(a.score||0));
  const scoreHTML = `<div>
    <div style="font-family:'Bebas Neue';font-size:.7rem;letter-spacing:.1em;opacity:.4;margin-bottom:4px">🏅 ĐIỂM</div>
    ${sorted.map((p,i) => `
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
        <span style="font-family:'Bebas Neue';font-size:.85rem;color:${i===0?'gold':i===1?'#ccc':'#cd7f32'}">#${i+1}</span>
        <span style="flex:1;font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.isBot?'🤖 ':''}${esc(p.name)}</span>
        <span style="font-family:'Bebas Neue'">${p.score||0}</span>
        ${p.id===rd.spyId?'<span style="color:#e74c3c;font-size:.65rem">SPY</span>':''}
      </div>`).join('')}
  </div>`;

  el.innerHTML = `
    <div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #252525">
      <div style="font-family:'Bebas Neue';letter-spacing:.12em;font-size:.85rem">${statusLabel}</div>
      <div style="opacity:.4;font-size:.68rem">Ván ${done+1}/${max}</div>
    </div>
    ${suspHTML}${scoreHTML}
    <div style="margin-top:8px;text-align:center">
      <button style="font-size:.65rem;opacity:.4;background:none;border:1px solid #333;color:#aaa;padding:3px 8px;cursor:pointer" onclick="doLeave()">Thoát</button>
    </div>`;
}

function renderBotBattleEnd(room) {
  const el = document.getElementById('botbattle-content');
  if (!el) return;
  const players = Object.values(room.players||{});
  const sorted  = [...players].sort((a,b)=>(b.score||0)-(a.score||0));
  el.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:1.5rem">🏆</div>
      <div style="font-family:'Bebas Neue';font-size:.9rem;letter-spacing:.1em;margin-bottom:8px">KẾT THÚC</div>
      ${sorted.map((p,i) => `
        <div style="display:flex;gap:6px;margin-bottom:3px;font-size:.78rem">
          <span style="color:${i===0?'gold':'#888'}">#${i+1}</span>
          <span style="flex:1">${esc(p.name)}</span>
          <span>${p.score||0}đ</span>
        </div>`).join('')}
      <button style="margin-top:12px;font-size:.72rem;background:none;border:1px solid #444;color:#aaa;padding:4px 10px;cursor:pointer" onclick="doLeave()">Về trang chủ</button>
    </div>`;
}

// ── Timer + Table + Chat riêng cho Bot Battle (bb-* ids) ──
function updateBotBattleTimer() {
  const m = Math.floor(S.timerRemaining / 60), s = S.timerRemaining % 60;
  const el = document.getElementById('bb-tb-timer');
  if (!el) return;
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.classList.toggle('urgent', S.timerRemaining <= 30 && S.timerRemaining > 0);
}

function buildBotBattleTable(room) {
  const players = room.playerList || Object.values(room.players || {});
  const n = players.length;
  const tableEl = document.getElementById('bb-round-table');
  if (!tableEl) { console.warn('[BB] bb-round-table not found!'); return; }
  tableEl.querySelectorAll('.table-player').forEach(el => el.remove());
  const size = tableEl.offsetWidth || 300;
  const cx = size / 2, cy = size / 2, r = size * 0.42;

  players.forEach((p, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
    const wrap = document.createElement('div');
    wrap.className = 'table-player';
    wrap.id = `bb-tp-${p.id}`;
    wrap.style.left = x + 'px'; wrap.style.top = y + 'px';
    const sector = Math.atan2(y - cy, x - cx);
    const arrDir = sector > -Math.PI/4 && sector < Math.PI/4 ? 'arr-right' :
                   sector >= Math.PI/4 && sector < 3*Math.PI/4 ? 'arr-down' :
                   sector <= -Math.PI/4 && sector > -3*Math.PI/4 ? 'arr-up' : 'arr-left';
    const avatarContent = makeAvatarHtml(p, '100%', true);
    wrap.innerHTML = `
      <div class="speech-bubble ${arrDir}" id="bb-bubble-${p.id}"></div>
      <div class="avatar${p.eliminated ? ' eliminated' : ''}" id="bb-avatar-${p.id}">
        ${avatarContent}
        ${p.eliminated ? '<div class="avatar-elim-badge">✕</div>' : ''}
      </div>
      <div class="avatar-name">${esc(p.name)}</div>`;
    tableEl.appendChild(wrap);
  });
  const centerEl = document.getElementById('bb-table-center-text');
  if (centerEl) centerEl.textContent = `${players.filter(p => !p.eliminated).length} bot`;
}

function updateBotBattleAvatars(room) {
  if (!room) return;
  _lastRoom = room;
  const players = room.playerList || Object.values(room.players || {});
  players.forEach(p => {
    const av = document.getElementById(`bb-avatar-${p.id}`);
    if (!av) return;
    av.classList.toggle('eliminated', !!p.eliminated);
    if (p.eliminated && !av.querySelector('.avatar-elim-badge')) {
      const x = document.createElement('div');
      x.className = 'avatar-elim-badge'; x.textContent = '✕';
      av.appendChild(x);
    }
  });
  const el = document.getElementById('bb-disc-voted-count');
  if (el) {
    const active = players.filter(p => !p.eliminated);
    const voted  = active.filter(p => room.round?.votes?.[p.id]).length;
    el.textContent = `${voted}/${active.length} đã vote`;
  }
}

function showBotBubble(playerId, text, dur = 4000) {
  const el = document.getElementById(`bb-bubble-${playerId}`);
  if (el) {
    el.textContent = text; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), dur);
  }
}

function setBotSpeaking(playerId, on) {
  document.getElementById(`bb-avatar-${playerId}`)?.classList.toggle('speaking', on);
}

function startBotChatListener() {
  if (S.chatListener) S.chatListener();
  const r = chatRef();
  const msgs = document.getElementById('bb-chat-messages');
  if (msgs) msgs.innerHTML = '';
  const cutoff = _lastRoom?.round?.chatStartTs || _lastRoom?.round?.discussStartAt || 0;
  let _renderedIds = new Set();

  const unsubscribe = onValue(r, snap => {
    if (!snap.exists()) return;
    const sorted = Object.values(snap.val() || {}).sort((a, b) => a.ts - b.ts);
    const fresh = sorted.filter(m => {
      if ((m.ts||0) < cutoff) return false;
      const id = m.ts + '_' + (m.uid||m.pid||'');
      if (_renderedIds.has(id)) return false;
      _renderedIds.add(id); return true;
    });
    if (!fresh.length) return;
    fresh.forEach(m => {
      _bbChatLog.push(m);
      if (_bbChatLog.length > 50) _bbChatLog.shift();
      appendBotChatMsg(m);
    });
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    if (S.chatCollapsed) {
      S.chatUnread += fresh.length;
      const badge = document.getElementById('bb-chat-unread-badge');
      if (badge) { badge.textContent = S.chatUnread > 9 ? '9+' : S.chatUnread; badge.classList.add('show'); }
    }
  });
  S.chatListener = () => { unsubscribe(); S.chatListener = null; };
}

function appendBotChatMsg(m) {
  const msgs = document.getElementById('bb-chat-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const playerData = Object.values(_lastRoom?.players || {}).find(p => p.id === m.pid);
  let avatarHtml = m.isBot ? '🤖' : '😊';
  if (playerData?.avatarUrl) {
    const url = fixDriveUrl(playerData.avatarUrl);
    avatarHtml = `<img src="${url}" class="chat-avatar-img" onerror="this.outerHTML='<span>${m.isBot ? '🤖' : '😊'}</span>'">`;
  }
  div.innerHTML = `
    <div class="chat-msg-avatar">${avatarHtml}</div>
    <div class="chat-msg-body">
      <div class="chat-msg-name">${esc(m.name)}</div>
      ${m.reaction
        ? `<div class="chat-msg-reaction">${m.reaction}</div>`
        : `<div class="chat-msg-text">${esc(m.text||'')}</div>`}
    </div>`;
  msgs.appendChild(div);
  const txt = m.text || m.reaction || '';
  showBotBubble(m.pid, txt.length > 40 ? txt.slice(0, 40) + '…' : txt, 4000);
}

function toggleBotChat() {
  S.chatCollapsed = !S.chatCollapsed;
  document.querySelector('#screen-botbattle .chat-panel')?.classList.toggle('collapsed', S.chatCollapsed);
  if (!S.chatCollapsed) {
    S.chatUnread = 0;
    document.getElementById('bb-chat-unread-badge')?.classList.remove('show');
    const msgs = document.getElementById('bb-chat-messages');
    if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 100);
  }
}


// ── Bot Battle overlay stats (góc phải bàn discussion) ──
function injectBotBattleOverlay(room) {
  let overlay = document.getElementById('bb-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bb-overlay';
    overlay.style.cssText = 'position:fixed;top:56px;right:8px;width:clamp(120px,32vw,180px);background:rgba(6,6,6,.88);border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;font-size:.7rem;max-height:50vh;overflow-y:auto;z-index:200;pointer-events:none;backdrop-filter:blur(4px)';
    document.body.appendChild(overlay);
  }
  updateBotBattleOverlay(room);
}

function updateBotBattleOverlay(room) {
  const overlay = document.getElementById('bb-overlay');
  if (!overlay) return;
  const players = room.playerList || Object.values(room.players||{});
  const rd   = room.round || {};
  const done = room.botBattleRoundsDone || 0;
  const max  = room.botBattleMaxRounds  || 10;
  const sorted = [...players].sort((a,b)=>(b.score||0)-(a.score||0));
  const bbRows = sorted.map((p,i) => {
    const isSpy = p.id === rd.spyId;
    const col = i===0?'gold':i===1?'#ccc':'#cd7f32';
    return `<div style="display:flex;align-items:center;gap:3px;margin-bottom:2px">
      <span style="font-family:'Bebas Neue';color:${col};font-size:.78rem;width:16px">#${i+1}</span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.7rem">${esc(p.name)}</span>
      ${isSpy ? '<span style="color:#e74c3c;font-size:.6rem">🕵️</span>' : ''}
      <span style="font-family:'Bebas Neue';font-size:.82rem">${p.score||0}</span>
    </div>`;
  }).join('');
  overlay.innerHTML = `<div style="font-family:'Bebas Neue';font-size:.72rem;letter-spacing:.1em;opacity:.45;margin-bottom:5px">🤖 VÁN ${done+1}/${max}</div>${bbRows}`;
}

function removeBotBattleOverlay() {
  const el = document.getElementById('bb-overlay');
  if (el) el.remove();
}

// -- EXPOSE GLOBALS --
window.nav=nav; window.copyJoinLink=copyJoinLink; window.flipCard=flipCard;
window.doCreateRoom=doCreateRoom; window.doJoinRoom=doJoinRoom;
window.doToggleReady=doToggleReady; window.doAddBot=doAddBot; window.doRemoveBot=doRemoveBot;
window.doConfirmCard=doConfirmCard;
window.doEarlyVote=doEarlyVote; window.doVote=doVote;
window.doSpyGuess=doSpyGuess; window.doNextRound=doNextRound; window.doLeave=doLeave;
window.doCreateBotBattle=doCreateBotBattle; window.toggleBotChat=toggleBotChat; window.removeBotBattleOverlay=removeBotBattleOverlay;
window.toggleChat=toggleChat; window.doSendChat=doSendChat;
