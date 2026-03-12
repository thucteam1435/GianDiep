import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, off, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ------------------------------------------------
//  ⚙️  CẤU HÌNH
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
};
let _wordPickedUp = false;

// ------------------------------------------------
//  BOT ACTION LOG
// ------------------------------------------------
const _botActionLog = {};

function logBotAction(botId, type, text, suspectName) {
  if (!_botActionLog[botId]) _botActionLog[botId] = [];
  _botActionLog[botId].push({ type, text, suspectName: suspectName || '', ts: Date.now() });
}

function clearBotActionLog() {
  Object.keys(_botActionLog).forEach(k => delete _botActionLog[k]);
}

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
//  AVATAR HELPER
// ------------------------------------------------
function fixDriveUrl(url) {
  if (!url) return '';
  // Chuyển uc?export=view sang thumbnail (tránh redirect CORS)
  const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w100`;
  // Dạng /file/d/FILE_ID/
  const m2 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m2) return `https://drive.google.com/thumbnail?id=${m2[1]}&sz=w100`;
  return url;
}

function makeAvatarHtml(player, size, forTable) {
  size = size || '36px';
  const defaultEmoji = player.isBot ? '🤖' : '😊';
  const url = fixDriveUrl(player.avatarUrl || '');

  if (url) {
    if (forTable) {
      return `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"
        onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span style=\\'font-size:1.2rem\\'>${defaultEmoji}</span>')">`;
    }
    return `<img src="${url}" class="lobby-avatar-img"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="lobby-avatar-emoji" style="display:none">${defaultEmoji}</div>`;
  }
  return forTable
    ? `<span style="font-size:1.2rem">${defaultEmoji}</span>`
    : `<div class="lobby-avatar-emoji">${defaultEmoji}</div>`;
}

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
    clearBotActionLog();
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
  if (S.myWord) { updateWordDisplay(); return; }
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
      players:{[playerId]:{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false,avatarUrl:''}}
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
    await set(playerRef(code,playerId),{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false,avatarUrl:''});
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
    return `<div class="player-row${p.isBot?' bot-row':''}">
      <div class="lobby-avatar-wrap">${makeAvatarHtml(p)}</div>
      <span class="pname">${esc(p.name)}</span>
      <span style="display:flex;gap:5px">${b.join('')}</span>
    </div>`;
  }).join('');

  const btn=document.getElementById('btn-ready');
  if(iAmReady){btn.textContent='✕ HỦY';btn.className='btn full red';}
  else{btn.textContent='✓ SẴN SÀNG';btn.className='btn full green';}
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
    const kw = await getKeywords();

    // Bước 1: Lấy danh sách tên đang dùng
    const snap = await get(roomRef());
    const room = snap.val();
    if (!room) { loading(false); return; }
    const players = Object.values(room.players || {});
    if (players.length >= 8) { toast('Phòng đầy! Tối đa 8 người.'); loading(false); return; }
    const usedNames = players.map(p => p.name);

    // Bước 2: Hỏi GAS lấy bot ngẫu nhiên từ Sky CotL roster
    let botName = '', botAvatar = '';
    try {
      const resp = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'bot_roster', usedNames })
      });
      const data = await resp.json();
      botName   = data.name      || '';
      botAvatar = data.avatarUrl || '';
    } catch(e) {
      console.warn('bot_roster GAS error:', e);
    }

    // Fallback nếu GAS lỗi
    if (!botName) {
      const roster = ["Daydream","Kizuna","Anubis","Teth","Daleth","Fire","Water","Air","Melan","Earth"];
      botName = roster.find(n => !usedNames.includes(n)) || ('Spirit #' + genId().slice(0,4));
    }

    // Bước 3: Thêm bot vào Firebase
    await runTransaction(roomRef(), room => {
      if (!room || room.status !== 'waiting') return room;
      const current = Object.values(room.players || {});
      if (current.length >= 8) return room;
      const botId = 'bot_' + genId();
      room.players[botId] = {
        id: botId, name: botName, ready: true, score: 0,
        isBot: true, cardConfirmed: false,
        avatarUrl: botAvatar
      };
      if (Object.values(room.players).length >= 3 &&
          Object.values(room.players).every(p => p.ready)) {
        beginRoundTx(room, kw);
      }
      return room;
    });
  } catch(e) { toast('Lỗi: ' + e.message); console.error(e); }
  finally { loading(false); }
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
//  TABLE SCREEN
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
  _lastRoom=room;
  S.earlyVoteChoice=null;
  S.earlyVoted=!!(room.round?.earlyVotes?.[S.playerId]);

  document.getElementById('tb-round-badge').textContent='VÒNG '+(room.roundNumber||1);
  document.getElementById('tb-word-display').textContent=S.myWord||'—';

  const startAt=room.round?.discussStartAt||Date.now();
  const duration=room.round?.discussDuration||120;
  S.timerRemaining=Math.max(0,duration-Math.floor((Date.now()-startAt)/1000));
  if(S.timerInterval) clearInterval(S.timerInterval);
  S.timerRunning=true;
  updateTableTimer();
  S.timerInterval=setInterval(()=>{
    S.timerRemaining=Math.max(0,S.timerRemaining-1);
    updateTableTimer();
    if(S.timerRemaining===0){clearInterval(S.timerInterval);S.timerRunning=false;doTimeUpVoting();}
  },1000);

  const tie=document.getElementById('table-tie-banner');
  if(tie) tie.style.display=room.round?.isTie?'block':'none';

  buildRoundTable(room);
  startChatListener();
  scheduleBotHints(room);

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

function buildRoundTable(room) {
  const players=room.playerList||Object.values(room.players||{});
  const n=players.length;
  const tableEl=document.getElementById('round-table');
  if(!tableEl) return;
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
    const sector=Math.atan2(y-cy,x-cx);
    const arrDir=sector>-Math.PI/4&&sector<Math.PI/4?'arr-right':
                 sector>=Math.PI/4&&sector<3*Math.PI/4?'arr-down':
                 sector<=-Math.PI/4&&sector>-3*Math.PI/4?'arr-up':'arr-left';
    const isMe=p.id===S.playerId;
    const canClick=!iAmEliminated&&!isMe&&!p.eliminated&&!S.earlyVoted;
    const hasVoted=!!(room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]);

    // Avatar: ảnh thật hoặc emoji fallback
    const avatarContent = makeAvatarHtml(p, '100%', true);

    wrap.innerHTML=`
      <div class="speech-bubble ${arrDir}" id="bubble-${p.id}"></div>
      <div class="avatar${isMe?' is-me':''}${p.eliminated?' eliminated':''}${canClick?' vote-target':''}" id="avatar-${p.id}" style="${canClick?'cursor:pointer;':''}">
        ${avatarContent}
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
    btn.innerHTML='<span>GỬI PHIẾU →</span>';
    btn.onclick=doEarlyVote;
    document.body.appendChild(btn);
  }
}

function updateTableAvatars(room) {
  if(!room) return;
  _lastRoom=room;
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

function updateDiscVoteStatus(room) {
  if(!room) return;
  const players=room.playerList||Object.values(room.players||{});
  const humans=players.filter(p=>!p.isBot&&!p.eliminated);
  const voted=humans.filter(p=>room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]).length;
  const el=document.getElementById('disc-voted-count');
  if(el) el.textContent=voted===humans.length?`✓ Tất cả ${humans.length} người đã vote`:`${voted}/${humans.length} người đã gửi phiếu`;
  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;
  const earlyPanel=document.getElementById('disc-early-vote-section');
  if(earlyPanel) earlyPanel.style.display='none';
  const votedNotice=document.getElementById('disc-voted-notice');
  if(votedNotice) votedNotice.style.display=(S.earlyVoted&&!iAmEliminated)?'block':'none';
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
    showBubble(S.playerId,'✓ Đã gửi phiếu',3000);
    updateDiscVoteStatus(_lastRoom||{round:{},players:{}});
  } catch(e){toast('Lỗi: '+e.message);console.error(e);S.earlyVoted=false;}
  finally{loading(false);}
}

function showBubble(playerId, text, dur=4000) {
  const el=document.getElementById(`bubble-${playerId}`);
  if(!el) return;
  el.textContent=text; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

function setAvatarSpeaking(playerId, on) {
  const el=document.getElementById(`avatar-${playerId}`);
  if(el) el.classList.toggle('speaking',on);
}

// ------------------------------------------------
//  GAS CALL
// ------------------------------------------------
async function callGAS(payload) {
  const resp = await fetch(GAS_URL, {
    method: 'POST',
    headers: {'Content-Type': 'text/plain'},
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error('GAS ' + resp.status);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.text?.trim() || '...';
}

// ------------------------------------------------
//  BOT AI
// ------------------------------------------------
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
      const t=setTimeout(()=>triggerBotAction(bot,i),delay);
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

  let recentChat='';
  let recentMsgs=[];
  try {
    const chatSnap=await get(ref(db,'rooms/'+S.roomId+'/chat'));
    if(chatSnap.exists()){
      recentMsgs=Object.values(chatSnap.val()).sort((a,b)=>a.ts-b.ts).slice(-8);
      recentChat=recentMsgs.map(m=>m.name+': '+(m.text||m.reaction||'')).join('\n');
    }
  } catch(e){}

  let action;
  if(actionIndex===0){
    action='hint';
  } else {
    const isMentioned=recentMsgs.some(m=>
      m.pid!==bot.id && (m.text||'').toLowerCase().includes(bot.name.toLowerCase())
    );
    action = isMentioned ? 'defend' : randItem(['hint','accuse','accuse','react','react']);
  }

  const msgCountByPlayer={};
  recentMsgs.forEach(m=>{ if(m.pid!==bot.id) msgCountByPlayer[m.pid]=(msgCountByPlayer[m.pid]||0)+1; });
  const mostActive=[...others].sort((a,b)=>(msgCountByPlayer[b.id]||0)-(msgCountByPlayer[a.id]||0));
  const suspect=mostActive.length
    ? (isSpy ? mostActive[0] : randItem(mostActive.slice(0,2).length?mostActive.slice(0,2):mostActive))
    : null;

  setAvatarSpeaking(bot.id,true);
  let finalText='';
  let usedFallback=false;

  try {
    finalText = await callGAS({
      action, botName:bot.name, word, isSpy,
      wordA:room.round?.wordA, wordB:room.round?.wordB,
      recentChat, suspectName:suspect?.name||'',
      players:others.map(p=>p.name)
    });
    showBubble(bot.id, finalText, 5000);
    postBotChat(bot, finalText);
  } catch(e) {
    usedFallback=true;
    const sn=suspect?.name||'';
    const fallbacks={
      hint:   isSpy?['Ờ tôi hiểu từ này...','Quen quen...','Tôi biết mà']
                   :['Rõ ràng quá còn gì','Tôi chắc 100%','Không cần đoán nhiều'],
      accuse: sn?[sn+' nói cứ sai sai','Tôi thấy '+sn+' mơ hồ lắm',sn+' không tự tin gì cả']
                :['Có người đang nói mơ hồ lắm','Ai đó không biết từ này rõ'],
      defend: isSpy?['Oan tôi quá!','Tôi biết từ mà, đừng nghi','Không phải tôi đâu nha']
                   :['Tôi biết từ này chắc như đinh','Nghi oan tôi rồi!','Tôi dân thường 100%'],
      react:  ['Đúng đúng!','Ờ cũng có lý','Hmm đáng ngờ thật','Tôi cũng thấy vậy','Lạ nhỉ...'],
    };
    finalText=randItem(fallbacks[action]||fallbacks.react);
    showBubble(bot.id,finalText,4000);
    postBotChat(bot,finalText);
  }

  logBotAction(bot.id, action, finalText, suspect?.name||'');

  if (!usedFallback) {
    const gameId = S.roomId + '_' + (room.roundNumber || 0);
    const role = isSpy ? 'spy' : 'villager';
    sendActionToGAS({
      action:  'log_action',
      gameId,
      botName: bot.name,
      role,
      actionType: action,
      text:    finalText,
      word,
      suspectName: suspect?.name || '',
      isSpy,
      wordA:   room.round?.wordA,
      wordB:   room.round?.wordB,
      playerList:  players.map(p=>p.name),
      keywordList: [room.round?.wordA, room.round?.wordB].filter(Boolean),
    });
  }

  setTimeout(()=>setAvatarSpeaking(bot.id,false),5500);
}

function sendActionToGAS(payload) {
  fetch(GAS_URL, {
    method: 'POST',
    headers: {'Content-Type': 'text/plain'},
    body: JSON.stringify(payload)
  }).catch(()=>{});
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
    const result=await callGAS({
      action:'vote', botName:bot.name, myWord, isSpy,
      wordVillager:room.round?.wordA, wordSpy:room.round?.wordB,
      candidates:candidates.map(p=>p.name), chatHistory
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
  if(S.chatListener){S.chatListener();}
  const r=chatRef();
  const msgs=document.getElementById('chat-messages');
  if(msgs) msgs.innerHTML='';
  const cutoff=_lastRoom?.round?.chatStartTs||_lastRoom?.round?.discussStartAt||0;
  let _renderedIds=new Set();

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
    fresh.forEach(m=>appendChatMsg(m));
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

  // Avatar trong chat: dùng ảnh nếu bot có avatarUrl
  const playerData = Object.values(_lastRoom?.players||{}).find(p=>p.id===m.pid);
  let chatAvatarHtml;
  if (playerData?.avatarUrl) {
    const fixedUrl = fixDriveUrl(playerData.avatarUrl);
    chatAvatarHtml = `<img src="${fixedUrl}" class="chat-avatar-img"
      onerror="this.outerHTML='<span>${m.isBot?'🤖':'😊'}</span>'">`;
  } else {
    chatAvatarHtml = m.isBot ? '🤖' : '😊';
  }

  div.innerHTML=`
    <div class="chat-msg-avatar">${chatAvatarHtml}</div>
    <div class="chat-msg-body">
      <div class="chat-msg-name">${esc(m.name)}</div>
      ${m.reaction
        ?`<div class="chat-msg-reaction">${m.reaction}</div>`
        :`<div class="chat-msg-text">${esc(m.text||'')}</div>`}
    </div>`;
  msgs.appendChild(div);
  if(m.text) showBubble(m.pid,m.text.length>40?m.text.slice(0,40)+'…':m.text,4000);
  if(m.reaction) showBubble(m.pid,m.reaction,2500);
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
//  VOTE SCREEN
// ------------------------------------------------
function renderVote(room) {
  S.selectedVote=null;
  const players=room.playerList||Object.values(room.players||{});
  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;
  const alreadyEarlyVoted=!!(room.round?.votes?.[S.playerId]);
  if(alreadyEarlyVoted) S.votedThisRound=true;
  const grid=document.getElementById('vote-grid');
  grid.innerHTML='';

  if(iAmEliminated){
    document.getElementById('btn-confirm-vote').style.display='none';
    document.getElementById('vote-waiting').style.display='none';
    renderSpectatorVotes(room);
  } else if(alreadyEarlyVoted){
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
    const nonSpy=active.filter(p=>p.id!==room.round.spyId);
    const spy=room.players[room.round.spyId];
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

// ------------------------------------------------
//  LEARN
// ------------------------------------------------
async function sendLearnPayload(room) {
  try {
    const rd = room.round;
    const players = room.playerList || Object.values(room.players || {});
    const bots = players.filter(p => p.isBot);
    if (!bots.length) return;

    const gameId = S.roomId + '_' + (room.roundNumber || 0);
    const playerList  = players.map(p => p.name);
    const keywordList = [rd.wordA, rd.wordB].filter(Boolean);

    const botsPayload = bots.map(bot => {
      const isSpy     = bot.id === rd.spyId;
      const won       = rd.result === (isSpy ? 'spy' : 'villagers');
      const word      = isSpy ? rd.wordB : rd.wordA;
      const actions = (_botActionLog[bot.id] || []).map(a => ({
        type:        a.type,
        text:        a.text,
        suspectName: a.suspectName
      }));
      const votedForId   = rd.votes?.[bot.id] || null;
      const votedForName = votedForId ? (players.find(p => p.id === votedForId)?.name || null) : null;
      const wasVotedBy = Object.entries(rd.votes || {})
        .filter(([, tid]) => tid === bot.id)
        .map(([pid]) => players.find(p => p.id === pid)?.name || pid);

      return {
        botName:      bot.name,
        role:         isSpy ? 'spy' : 'villager',
        won, word,
        wordA:        rd.wordA,
        wordB:        rd.wordB,
        actions,
        votedFor:     votedForName,
        _votedForId:  votedForId,
        wasVotedBy,
        spyId:        rd.spyId
      };
    });

    sendActionToGAS({
      action: 'learn',
      gameId,
      playerList,
      keywordList,
      bots: botsPayload
    });
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
    S.myWord=null; _wordPickedUp=false; save();
  } catch(e){toast('Lỗi: '+e.message);console.error(e);}
  finally{loading(false);}
}

async function doLeave() {
  stopListening();
  if(S.timerInterval) clearInterval(S.timerInterval);
  if(S.voteTimerInterval) clearInterval(S.voteTimerInterval);
  if(_summaryTimer) clearInterval(_summaryTimer);
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

const rp=document.getElementById('reaction-picker');
if(rp) REACTIONS.forEach(e=>{
  const btn=document.createElement('button');
  btn.className='reaction-btn'; btn.textContent=e;
  btn.onclick=()=>doSendReaction(e);
  rp.appendChild(btn);
});

// -- EXPOSE GLOBALS --
window.nav=nav; window.copyJoinLink=copyJoinLink; window.flipCard=flipCard;
window.doCreateRoom=doCreateRoom; window.doJoinRoom=doJoinRoom;
window.doToggleReady=doToggleReady; window.doAddBot=doAddBot; window.doRemoveBot=doRemoveBot;
window.doConfirmCard=doConfirmCard;
window.doEarlyVote=doEarlyVote; window.doVote=doVote;
window.doSpyGuess=doSpyGuess; window.doNextRound=doNextRound; window.doLeave=doLeave;
window.toggleChat=toggleChat; window.doSendChat=doSendChat;
