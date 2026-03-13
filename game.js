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
  isBotBattle:false,
  isObserver:false,
};
let _wordPickedUp = false;
let _autoBotVoteDone = false;
let _autoBotSpyGuessDone = false;
let _botBattleAdvanceTimer = null;
let _bbChatLog = [];

// ------------------------------------------------
//  BOT ACTION LOG
// ------------------------------------------------
const _botActionLog = {};
function logBotAction(botId, type, text, suspectName) {
  if (!_botActionLog[botId]) _botActionLog[botId] = [];
  _botActionLog[botId].push({ type, text, suspectName: suspectName||'', ts: Date.now() });
}
function clearBotActionLog() {
  Object.keys(_botActionLog).forEach(k => delete _botActionLog[k]);
}

// ================================================
//  SUSPICION SYSTEM
//  _suspicionMap[observerId][targetId] = score 0-100
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

function clearSuspicion() {
  _suspicionMap = {};
}

function updateSuspicion(speakerId, actionType, text, targetId, allPlayerIds, round) {
  const lower   = (text || '').toLowerCase();
  const wordB   = (round?.wordB || '').toLowerCase();

  allPlayerIds.forEach(observerId => {
    if (observerId === speakerId) return;
    if (!_suspicionMap[observerId]) _suspicionMap[observerId] = {};
    let delta = 0;

    if (actionType === 'hint') {
      const wc = text.trim().split(/\s+/).length;
      if (wc < 4)  delta += 8;
      if (wc > 14) delta += 4;
      if (wordB && lower.includes(wordB)) delta += 25;
      if (/\b(thường|hay|dùng để|màu|hình|mùi|vị|cảm giác|dành cho)\b/i.test(text)) delta -= 5;
    }
    if (actionType === 'defend') {
      delta -= 6;
      if (wordB && lower.includes(wordB)) delta += 30;
    }
    if (actionType === 'accuse') {
      delta += 2;
    }

    const cur = _suspicionMap[observerId][speakerId] ?? 10;
    _suspicionMap[observerId][speakerId] = Math.max(0, Math.min(100, cur + delta));
  });

  if (actionType === 'accuse' && targetId && _suspicionMap[targetId]) {
    const cur = _suspicionMap[targetId][speakerId] ?? 10;
    _suspicionMap[targetId][speakerId] = Math.max(0, Math.min(100, cur + 5));
  }
}

function getTopSuspect(botId, candidates) {
  const scores = _suspicionMap[botId] || {};
  let best = null, bestScore = -1;
  candidates.forEach(p => {
    const s = scores[p.id] ?? 10;
    if (s > bestScore) { bestScore = s; best = p; }
  });
  return best;
}

function serializeSuspicion(botId, players) {
  const scores = _suspicionMap[botId] || {};
  return players
    .filter(p => p.id !== botId)
    .map(p => `${p.name}:${Math.round(scores[p.id] ?? 10)}`)
    .join(',');
}

// ------------------------------------------------
//  PERSIST
// ------------------------------------------------
function save() {
  try { localStorage.setItem('gd_fb1', JSON.stringify({
    roomId:S.roomId, playerId:S.playerId, playerName:S.playerName, myWord:S.myWord,
    isBotBattle:S.isBotBattle, isObserver:S.isObserver
  })); } catch(e) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('gd_fb1')||'null');
    if (d) {
      S.roomId=d.roomId||''; S.playerId=d.playerId||'';
      S.playerName=d.playerName||''; S.myWord=d.myWord||null;
      S.isBotBattle=!!d.isBotBattle; S.isObserver=!!d.isObserver;
    }
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
  const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w100`;
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

  // ✅ FIX BUG 3: Luôn check roundNumber thay đổi TRƯỚC khi route sang botBattle
  //    Đảm bảo clearBotActionLog/clearSuspicion chạy ngay cả với phòng bot battle
  if (room.status === 'playing' && room.roundNumber !== S._lastRound) {
    S._lastRound = room.roundNumber;
    S.cardFlipped=false; S.cardConfirmed=false;
    S.votedThisRound=false; S.earlyVoted=false; S.earlyVoteChoice=null;
    S.spyGuessSubmitted=false; _wordPickedUp=false;
    _autoBotVoteDone=false; _autoBotSpyGuessDone=false;
    if (_botBattleAdvanceTimer) { clearTimeout(_botBattleAdvanceTimer); _botBattleAdvanceTimer=null; }
    clearBotActionLog();   // ✅ reset action log cho ván mới
    clearSuspicion();      // ✅ reset suspicion cho ván mới
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
    S.roomId=roomId; S.playerId=playerId; S.playerName=name; S.myWord=null;
    S.isBotBattle=false; S.isObserver=false; save();
    await set(roomRef(roomId),{
      id:roomId, createdAt:Date.now(), status:'waiting', hostId:playerId, roundNumber:0,
      isBotBattle:false,
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
    S.roomId=code; S.playerId=playerId; S.playerName=name; S.myWord=null;
    S.isBotBattle=false; S.isObserver=false; save();
    await set(playerRef(code,playerId),{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false,avatarUrl:''});
    listenRoom(code); nav('lobby',{room:code});
  } catch(e){toast('❌ '+e.message);console.error(e);}
  finally{loading(false);}
}

// ================================================
//  BOT BATTLE ROOM
// ================================================
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

    const players = {};
    const usedNames = [];
    const fallbackRoster = ["Daydream","Kizuna","Anubis","Teth","Daleth","Fire","Water","Air","Melan","Earth"];
    for (let i = 0; i < 5; i++) {
      let botName = '', botAvatar = '';
      try {
        const resp = await fetch(GAS_URL, {
          method: 'POST',
          headers: {'Content-Type':'text/plain'},
          body: JSON.stringify({ action:'bot_roster', usedNames })
        });
        const data = await resp.json();
        botName = data.name||''; botAvatar = data.avatarUrl||'';
      } catch(e) { console.warn('bot_roster GAS error:', e); }
      if (!botName || usedNames.includes(botName)) {
        botName = fallbackRoster.find(n=>!usedNames.includes(n)) || ('Spirit #'+genId().slice(0,4));
        botAvatar = '';
      }
      usedNames.push(botName);
      const botId = 'bot_' + genId();
      // ✅ FIX BUG 2: Lưu avatarUrl đã fix CORS ngay khi tạo bot
      players[botId] = {
        id: botId, name: botName, ready:true, score:0,
        isBot:true, cardConfirmed:true,
        avatarUrl: fixDriveUrl(botAvatar)
      };
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

    await runTransaction(roomRef(), room => {
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

// ------------------------------------------------
//  BOT BATTLE FLOW
// ------------------------------------------------
function handleBotBattleFlow(room) {
  if (parseHash().screen !== 'botbattle') nav('botbattle', {room:S.roomId});

  const status  = room.status;
  const players = room.playerList || Object.values(room.players||{});

  renderBotBattleObserver(room);

  if (status === 'waiting') return;

  if (status === 'playing') {
    autoBotConfirmCards(room);
    return;
  }

  if (status === 'discussing') {
    if (!S._inDiscussion) {
      S._inDiscussion = true;
      _lastRoom = room;
      S.earlyVoteChoice = null;
      S.earlyVoted = false;

      const startAt  = room.round?.discussStartAt  || Date.now();
      const duration = room.round?.discussDuration  || 90;
      S.timerRemaining = Math.max(0, duration - Math.floor((Date.now() - startAt) / 1000));
      if (S.timerInterval) clearInterval(S.timerInterval);
      S.timerRunning = true;
      S.timerInterval = setInterval(() => {
        S.timerRemaining = Math.max(0, S.timerRemaining - 1);
        if (S.timerRemaining === 0) { clearInterval(S.timerInterval); S.timerRunning = false; }
      }, 1000);

      initSuspicion(players);

      // ✅ FIX BUG 2: Bot battle dùng round-table trong discussion screen riêng
      // Không gọi buildRoundTable() vì botbattle screen không có #round-table
      // Chỉ hiển thị overlay và chat
      injectBotBattleOverlay(room);
      startBotChatListener();
      scheduleBotHints(room);

      S.chatCollapsed = false;
      document.querySelector('#screen-botbattle .chat-panel')?.classList.remove('collapsed');
    } else {
      _lastRoom = room;
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
  _autoBotVoteDone = true;
  try {
    const players  = Object.values(room.players||{});
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
  } catch(e) { console.error('autoBotVote', e); }
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
    // ✅ FIX BUG 4: Reset action log và suspicion cho ván bot battle mới
    clearBotActionLog();
    clearSuspicion();
    _autoBotVoteDone=false; _autoBotSpyGuessDone=false;
    S._inDiscussion=false;
  } catch(e){ toast('Lỗi: '+e.message); console.error(e); }
  finally { loading(false); }
}

// ------------------------------------------------
//  BOT BATTLE OBSERVER UI
// ------------------------------------------------
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

  // Suspicion heatmap
  let suspHTML = '';
  const hasSusp = status === 'discussing' && Object.keys(_suspicionMap).length > 0;
  if (hasSusp) {
    suspHTML = `
    <div class="bb-section">
      <div class="bb-section-title">🧠 Ma trận nghi ngờ</div>
      <div style="overflow-x:auto">
      <table class="bb-susp-table">
        <thead><tr>
          <th style="text-align:left">↓ nghi ↗</th>
          ${players.map(p=>`<th>${esc(p.name.split(' ')[0])}</th>`).join('')}
        </tr></thead>
        <tbody>${players.map(observer => `
          <tr>
            <td style="font-weight:bold;white-space:nowrap">${esc(observer.name)}</td>
            ${players.map(target => {
              if (observer.id === target.id) return '<td style="background:#222;color:#555">—</td>';
              const score = _suspicionMap[observer.id]?.[target.id] ?? 10;
              const pct   = score / 100;
              const r2    = Math.round(50 + pct * 200);
              const g2    = Math.round(180 - pct * 180);
              return `<td style="background:rgb(${r2},${g2},50);color:#fff;font-weight:bold;text-align:center">${Math.round(score)}</td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
  }

  // Scoreboard
  const sorted = [...players].sort((a,b)=>(b.score||0)-(a.score||0));
  const scoreHTML = `
  <div class="bb-section">
    <div class="bb-section-title">🏅 Bảng điểm</div>
    ${sorted.map((p,i) => `
      <div class="bb-score-row">
        <span class="bb-rank" style="${i===0?'color:gold':i===1?'color:#ccc':'color:#cd7f32'}">#${i+1}</span>
        <div class="bb-avatar-wrap" style="width:28px;height:28px;border-radius:50%;overflow:hidden;flex-shrink:0">${makeAvatarHtml(p,'28px',true)}</div>
        <span class="bb-name">${esc(p.name)}</span>
        <span class="bb-pts">${p.score||0} pt</span>
        ${p.id===rd.spyId ? '<span class="bb-badge spy">🕵️ SPY</span>' : ''}
        ${p.eliminated ? '<span class="bb-badge elim">❌</span>' : ''}
      </div>`).join('')}
  </div>`;

  // Chat log
  let chatHTML = '';
  if (_bbChatLog.length) {
    chatHTML = `
    <div class="bb-section">
      <div class="bb-section-title">💬 Chat gần đây</div>
      ${_bbChatLog.slice(-10).map(m => `
        <div class="bb-chat-row">
          <b>${esc(m.name)}</b>: ${esc(m.text||m.reaction||'...')}
        </div>`).join('')}
    </div>`;
  }

  el.innerHTML = `
    <div class="bb-header">
      <div class="bb-title">🤖 BOT BATTLE</div>
      <div class="bb-status">${statusLabel}</div>
      <div class="bb-progress">Ván <b>${done+1}</b> / ${max}</div>
    </div>
    ${suspHTML}
    ${scoreHTML}
    ${chatHTML}
    <div style="text-align:center;padding:12px 0">
      <button class="btn" style="opacity:.6;font-size:.8rem" onclick="doLeave()">Thoát phòng</button>
    </div>
  `;
}

function renderBotBattleEnd(room) {
  const el = document.getElementById('botbattle-content');
  if (!el) return;
  const players = Object.values(room.players||{});
  const sorted  = [...players].sort((a,b)=>(b.score||0)-(a.score||0));
  el.innerHTML = `
    <div class="bb-end">
      <div style="font-size:2.5rem;margin-bottom:8px">🏆</div>
      <div style="font-family:'Bebas Neue';font-size:1.6rem;letter-spacing:.1em">KẾT THÚC BOT BATTLE</div>
      <div style="opacity:.6;margin-bottom:20px">${room.botBattleMaxRounds} ván hoàn thành</div>
      ${sorted.map((p,i) => `
        <div class="bb-score-row bb-end-row">
          <span class="bb-rank" style="${i===0?'color:gold;font-size:1.4rem':''}">#${i+1}</span>
          <div class="bb-avatar-wrap" style="width:28px;height:28px;border-radius:50%;overflow:hidden;flex-shrink:0">${makeAvatarHtml(p,'28px',true)}</div>
          <span class="bb-name">${esc(p.name)}</span>
          <span class="bb-pts">${p.score||0} điểm</span>
        </div>`).join('')}
      <button class="btn full green" style="margin-top:24px" onclick="doLeave()">Về trang chủ</button>
    </div>`;
}

// ================================================
//  LOBBY
// ================================================
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
    const snap = await get(roomRef());
    const room = snap.val();
    if (!room) { loading(false); return; }
    const players = Object.values(room.players || {});
    if (players.length >= 8) { toast('Phòng đầy!'); loading(false); return; }
    const usedNames = players.map(p => p.name);

    let botName = '', botAvatar = '';
    try {
      const resp = await fetch(GAS_URL, {
        method:'POST', headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({action:'bot_roster', usedNames})
      });
      const data = await resp.json();
      botName = data.name||''; botAvatar = data.avatarUrl||'';
    } catch(e) { console.warn('bot_roster GAS error:', e); }

    if (!botName) {
      const roster=["Daydream","Kizuna","Anubis","Teth","Daleth","Fire","Water","Air","Melan","Earth"];
      botName = roster.find(n=>!usedNames.includes(n)) || ('Spirit #'+genId().slice(0,4));
    }

    await runTransaction(roomRef(), room => {
      if (!room || room.status !== 'waiting') return room;
      if (Object.values(room.players||{}).length >= 8) return room;
      const botId = 'bot_' + genId();
      room.players[botId] = {
        id:botId, name:botName, ready:true, score:0,
        isBot:true, cardConfirmed:false,
        avatarUrl: fixDriveUrl(botAvatar)
      };
      if (Object.values(room.players).length >= 3 && Object.values(room.players).every(p=>p.ready))
        beginRoundTx(room, kw);
      return room;
    });
  } catch(e) { toast('Lỗi: '+e.message); console.error(e); }
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
  } catch(e){toast('Lỗi: '+e.message);}
  finally{loading(false);}
}

// ------------------------------------------------
//  BEGIN ROUND
// ------------------------------------------------
function beginRoundTx(room, keywords) {
  const row=randItem(keywords), shuffled=[...row].sort(()=>Math.random()-.5);
  const wordA=shuffled[0], wordB=shuffled[1];
  const players=Object.values(room.players), spy=randItem(players);
  room.status='playing'; room.roundNumber=(room.roundNumber||0)+1;
  room.round={wordA,wordB,spyId:spy.id,votes:{},voteCounts:{},spyGuess:null,result:null,
    discussStartAt:null,discussDuration:90};
  room._wordAssignments={};
  players.forEach(p=>{
    room._wordAssignments[p.id]=(p.id===spy.id)?wordB:wordA;
    p.cardConfirmed=!!p.isBot; p.ready=false; p.eliminated=false;
  });
  if(players.every(p=>p.cardConfirmed)){
    room.status='discussing'; room.round.discussStartAt=Date.now();
    room.round.chatStartTs=Date.now(); delete room._wordAssignments;
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
  const el=document.getElementById('card-confirm-count');
  if(el) el.textContent=`${confirmed}/${humans.length} người đã xem xong`;
}
function flipCard() {
  if(!S.cardFlipped){
    S.cardFlipped=true;
    document.getElementById('card-wrap').classList.add('flipped');
    document.getElementById('btn-confirm-card').disabled=false;
    updateWordDisplay();
  }
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
      room.status='discussing'; room.round.discussStartAt=Date.now();
      room.round.chatStartTs=Date.now();
    }
    return room;
  });
}

// ------------------------------------------------
//  DISCUSSION SCREEN
// ------------------------------------------------
let _botHintTimers = [];
let _lastRoom = null;

function startDiscussionScreen(room) {
  if (S._inDiscussion) {
    _lastRoom=room; updateTableAvatars(room); updateDiscVoteStatus(room); return;
  }
  S._inDiscussion=true;
  _lastRoom=room;
  S.earlyVoteChoice=null;
  S.earlyVoted=!!(room.round?.earlyVotes?.[S.playerId]);

  const players = room.playerList || Object.values(room.players||{});
  initSuspicion(players);

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

  S.chatCollapsed=true; S.chatUnread=0;
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
  if(!tableEl) return;  // ✅ guard: không crash nếu element không tồn tại
  tableEl.querySelectorAll('.table-player').forEach(el=>el.remove());
  const size=tableEl.offsetWidth||300;
  const cx=size/2, cy=size/2, r=size*0.42;
  const me=players.find(p=>p.id===S.playerId);
  const iAmEliminated=me?.eliminated||false;

  players.forEach((p,i)=>{
    const angle=(2*Math.PI*i/n)-Math.PI/2;
    const x=cx+r*Math.cos(angle), y=cy+r*Math.sin(angle);
    const wrap=document.createElement('div');
    wrap.className='table-player'; wrap.id=`tp-${p.id}`;
    wrap.style.left=x+'px'; wrap.style.top=y+'px';
    const sector=Math.atan2(y-cy,x-cx);
    const arrDir=sector>-Math.PI/4&&sector<Math.PI/4?'arr-right':
                 sector>=Math.PI/4&&sector<3*Math.PI/4?'arr-down':
                 sector<=-Math.PI/4&&sector>-3*Math.PI/4?'arr-up':'arr-left';
    const isMe=p.id===S.playerId;
    const canClick=!iAmEliminated&&!isMe&&!p.eliminated&&!S.earlyVoted&&!S.isObserver;
    const hasVoted=!!(room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]);
    const avatarContent=makeAvatarHtml(p,'100%',true);

    wrap.innerHTML=`
      <div class="speech-bubble ${arrDir}" id="bubble-${p.id}"></div>
      <div class="avatar${isMe?' is-me':''}${p.eliminated?' eliminated':''}${canClick?' vote-target':''}" id="avatar-${p.id}" style="${canClick?'cursor:pointer;':''}">
        ${avatarContent}
        <div class="avatar-voted-badge${hasVoted?' show':''}" id="voted-${p.id}">✓</div>
        ${p.eliminated?'<div class="avatar-elim-badge">✕</div>':''}
        <div class="avatar-vote-ring" id="ring-${p.id}"></div>
      </div>
      <div class="avatar-name${isMe?' is-me':''}">${esc(p.name)}</div>`;
    if(canClick){
      wrap.querySelector(`#avatar-${p.id}`).addEventListener('click',()=>handleAvatarVoteClick(p.id,players));
    }
    tableEl.appendChild(wrap);
  });
  document.getElementById('table-center-text').textContent=`${players.filter(p=>!p.eliminated).length} người`;
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
  if(!S.earlyVoteChoice){ if(btn) btn.remove(); return; }
  if(!btn){
    btn=document.createElement('button');
    btn.id='avatar-vote-confirm-btn'; btn.className='btn red full';
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
        const x=document.createElement('div'); x.className='avatar-elim-badge'; x.textContent='✕'; av.appendChild(x);
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
  document.getElementById('disc-early-vote-section')?.style.setProperty('display','none');
  const vn=document.getElementById('disc-voted-notice');
  if(vn) vn.style.display=(S.earlyVoted&&!iAmEliminated)?'block':'none';
}

async function doEarlyVote() {
  if(!S.earlyVoteChoice){toast('Hãy chọn!');return;}
  S.earlyVoted=true; loading(true);
  document.getElementById('avatar-vote-confirm-btn')?.remove();
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
          const topSusp=getTopSuspect(bot.id,others);
          if(others.length) room.round.votes[bot.id]=topSusp?topSusp.id:randItem(others).id;
        });
        delete room.round.earlyVotes; resolveVotesTx(room);
      }
      return room;
    });
    showBubble(S.playerId,'✓ Đã gửi phiếu',3000);
    updateDiscVoteStatus(_lastRoom||{round:{},players:{}});
  } catch(e){toast('Lỗi: '+e.message);S.earlyVoted=false;}
  finally{loading(false);}
}

function showBubble(playerId, text, dur=4000) {
  const el=document.getElementById(`bubble-${playerId}`);
  if(!el) return;
  el.textContent=text; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

function setAvatarSpeaking(playerId, on) {
  document.getElementById(`avatar-${playerId}`)?.classList.toggle('speaking',on);
}

// ------------------------------------------------
//  GAS CALL
// ------------------------------------------------
async function callGAS(payload) {
  const resp = await fetch(GAS_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error('GAS '+resp.status);
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

  bots.forEach((bot, botIndexInRoom) => {
    const numActions=2+Math.floor(Math.random()*2);
    const usedSlots=new Set();
    for(let i=0;i<numActions;i++){
      let delay;
      do { delay=6000+Math.random()*(duration*0.8); } while(usedSlots.has(Math.floor(delay/6000)));
      usedSlots.add(Math.floor(delay/6000));
      const t=setTimeout(()=>triggerBotAction(bot, i, botIndexInRoom), delay);
      _botHintTimers.push(t);
    }
  });
}

async function triggerBotAction(bot, actionIndex, botIndexInRoom) {
  const curScreen = parseHash().screen;
  if (curScreen !== 'discussion' && !S.isBotBattle) return;
  const room = _lastRoom;
  if (!room) return;
  const botCurrent = Object.values(room.players||{}).find(p=>p.id===bot.id);
  if (!botCurrent||botCurrent.eliminated) return;

  const isSpy  = bot.id===room.round?.spyId;
  const word   = isSpy ? room.round?.wordB : room.round?.wordA;
  const players= room.playerList||Object.values(room.players||{});
  const others = players.filter(p=>p.id!==bot.id&&!p.eliminated);

  let recentChat='', recentMsgs=[];
  try {
    const chatSnap=await get(ref(db,'rooms/'+S.roomId+'/chat'));
    if(chatSnap.exists()){
      recentMsgs=Object.values(chatSnap.val()).sort((a,b)=>a.ts-b.ts).slice(-8);
      recentChat=recentMsgs.map(m=>m.name+': '+(m.text||m.reaction||'')).join('\n');
    }
  } catch(e){}

  // Chọn action
  let action;
  if(actionIndex===0){
    action='hint';
  } else {
    const isMentioned=recentMsgs.some(m=>
      m.pid!==bot.id&&(m.text||'').toLowerCase().includes(bot.name.toLowerCase())
    );
    action = isMentioned ? 'defend' : randItem(['hint','accuse','accuse','react','react']);
  }

  // Chọn suspect: ưu tiên suspicion map
  let suspect = null;
  if (action==='accuse') {
    suspect = getTopSuspect(bot.id, others) || (others.length?randItem(others):null);
  } else {
    const msgCount={};
    recentMsgs.forEach(m=>{ if(m.pid!==bot.id) msgCount[m.pid]=(msgCount[m.pid]||0)+1; });
    const mostActive=[...others].sort((a,b)=>(msgCount[b.id]||0)-(msgCount[a.id]||0));
    suspect = mostActive.length
      ? (isSpy ? mostActive[0] : randItem(mostActive.slice(0,2).length?mostActive.slice(0,2):mostActive))
      : null;
  }

  const gameId   = S.roomId + '_' + (room.roundNumber||0);
  const botIndex = botIndexInRoom !== undefined ? botIndexInRoom
    : players.filter(p=>p.isBot&&!p.eliminated).findIndex(b=>b.id===bot.id);

  const suspicionContext = serializeSuspicion(bot.id, others);

  setAvatarSpeaking(bot.id, true);
  let finalText='', usedFallback=false;

  try {
    finalText = await callGAS({
      action,
      botName:          bot.name,
      word, isSpy,
      wordA:            room.round?.wordA,
      wordB:            room.round?.wordB,
      recentChat,
      suspectName:      suspect?.name||'',
      players:          others.map(p=>p.name),
      allNames:         players.map(p=>p.name),
      gameId, botIndex,
      suspicionContext
    });

    const allIds = players.map(p=>p.id);
    updateSuspicion(bot.id, action, finalText, suspect?.id||null, allIds, room.round);

    showBubble(bot.id, finalText, 5000);
    postBotChat(bot, finalText);
  } catch(e) {
    usedFallback=true;
    const sn=suspect?.name||'';
    const fallbacks={
      hint:   isSpy?['Ờ tôi hiểu từ này...','Quen quen...','Tôi biết mà']
                   :['Rõ ràng quá còn gì','Tôi chắc 100%','Không cần đoán nhiều'],
      accuse: sn?[sn+' nói cứ sai sai','Tôi thấy '+sn+' mơ hồ lắm',sn+' không tự tin gì cả']
                :['Có người đang nói mơ hồ lắm'],
      defend: isSpy?['Oan tôi quá!','Không phải tôi đâu nha']
                   :['Tôi biết từ này chắc như đinh','Nghi oan tôi rồi!'],
      react:  ['Đúng đúng!','Ờ cũng có lý','Hmm đáng ngờ thật','Lạ nhỉ...'],
    };
    finalText=randItem(fallbacks[action]||fallbacks.react);
    const allIds=players.map(p=>p.id);
    updateSuspicion(bot.id, action, finalText, suspect?.id||null, allIds, room.round);
    showBubble(bot.id, finalText, 4000);
    postBotChat(bot, finalText);
  }

  logBotAction(bot.id, action, finalText, suspect?.name||'');

  if (!usedFallback) {
    sendActionToGAS({
      action:'log_action', gameId,
      botName:bot.name, role:isSpy?'spy':'villager',
      actionType:action, text:finalText, word,
      suspectName:suspect?.name||'', isSpy,
      wordA:room.round?.wordA, wordB:room.round?.wordB,
      playerList:players.map(p=>p.name),
      keywordList:[room.round?.wordA,room.round?.wordB].filter(Boolean),
    });
  }

  setTimeout(()=>setAvatarSpeaking(bot.id,false), 5500);
}

function sendActionToGAS(payload) {
  fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(payload)}).catch(()=>{});
}

async function getBotVoteTarget(bot, room) {
  const players=Object.values(room.players||{});
  const candidates=players.filter(p=>p.id!==bot.id&&!p.eliminated);
  if(!candidates.length) return null;
  const topSusp = getTopSuspect(bot.id, candidates);
  if (topSusp) return topSusp.id;
  try {
    const chatSnap=await get(ref(db,`rooms/${S.roomId}/chat`));
    let chatHistory='';
    if(chatSnap.exists()){
      chatHistory=Object.values(chatSnap.val()).sort((a,b)=>a.ts-b.ts).slice(-10)
        .map(m=>`${m.name}: ${m.text||m.reaction||''}`).join('\n');
    }
    const isSpy=bot.id===room.round?.spyId;
    const gameId=S.roomId+'_'+(room.roundNumber||0);
    const result=await callGAS({
      action:'vote', botName:bot.name,
      myWord:isSpy?room.round?.wordB:room.round?.wordA, isSpy,
      wordVillager:room.round?.wordA, wordSpy:room.round?.wordB,
      candidates:candidates.map(p=>p.name), chatHistory,
      suspicionContext:serializeSuspicion(bot.id,candidates), gameId
    });
    const target=candidates.find(p=>p.name===result?.trim());
    return target?.id||randItem(candidates).id;
  } catch(e){ return randItem(candidates).id; }
}

// ------------------------------------------------
//  CHAT
// ------------------------------------------------
const REACTIONS=['😂','🤔','😱','👀','🤥','✅'];

function startChatListener() {
  if(S.chatListener) S.chatListener();
  const r=chatRef();
  const msgs=document.getElementById('chat-messages');
  if(msgs) msgs.innerHTML='';
  const cutoff=_lastRoom?.round?.chatStartTs||_lastRoom?.round?.discussStartAt||0;
  let _renderedIds=new Set();
  _bbChatLog=[];

  const unsubscribe=onValue(r,snap=>{
    if(!snap.exists()) return;
    const sorted=Object.values(snap.val()||{}).sort((a,b)=>a.ts-b.ts);
    const fresh=sorted.filter(m=>{
      if((m.ts||0)<cutoff) return false;
      const id=m.ts+'_'+(m.uid||m.pid||'');
      if(_renderedIds.has(id)) return false;
      _renderedIds.add(id); return true;
    });
    if(!fresh.length) return;
    fresh.forEach(m=>{
      _bbChatLog.push(m);
      if(_bbChatLog.length>50) _bbChatLog.shift();
      appendChatMsg(m);
      if(!m.isBot&&m.pid&&m.text){
        const allPlayers=_lastRoom?Object.values(_lastRoom.players||{}):[];
        const allIds=allPlayers.map(p=>p.id);
        updateSuspicion(m.pid,'hint',m.text,null,allIds,_lastRoom?.round||{});
      }
    });
    if(msgs) msgs.scrollTop=msgs.scrollHeight;
    if(S.chatCollapsed){
      S.chatUnread+=fresh.length;
      const badge=document.getElementById('chat-unread-badge');
      if(badge){badge.textContent=S.chatUnread>9?'9+':S.chatUnread;badge.classList.add('show');}
    }
  });
  S.chatListener=()=>{unsubscribe();S.chatListener=null;};
}

function appendChatMsg(m) {
  const msgs=document.getElementById('chat-messages');
  if(!msgs) return;
  const isMe=m.pid===S.playerId;
  const div=document.createElement('div');
  div.className='chat-msg'+(isMe?' mine':'');
  const playerData=Object.values(_lastRoom?.players||{}).find(p=>p.id===m.pid);
  let chatAvatarHtml;
  if(playerData?.avatarUrl){
    const fixedUrl=fixDriveUrl(playerData.avatarUrl);
    chatAvatarHtml=`<img src="${fixedUrl}" class="chat-avatar-img" onerror="this.outerHTML='<span>${m.isBot?'🤖':'😊'}</span>'">`;
  } else {
    chatAvatarHtml=m.isBot?'🤖':'😊';
  }
  div.innerHTML=`
    <div class="chat-msg-avatar">${chatAvatarHtml}</div>
    <div class="chat-msg-body">
      <div class="chat-msg-name">${esc(m.name)}</div>
      ${m.reaction?`<div class="chat-msg-reaction">${m.reaction}</div>`:`<div class="chat-msg-text">${esc(m.text||'')}</div>`}
    </div>`;
  msgs.appendChild(div);
  if(m.text) showBubble(m.pid,m.text.length>40?m.text.slice(0,40)+'…':m.text,4000);
  if(m.reaction) showBubble(m.pid,m.reaction,2500);
}

async function postBotChat(bot,text) {
  try {
    await set(ref(db,`rooms/${S.roomId}/chat/${genId()}`),{
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
    await set(ref(db,`rooms/${S.roomId}/chat/${genId()}`),{
      pid:S.playerId, name:S.playerName, text, isBot:false, ts:Date.now()
    });
  } catch(e){console.error(e);}
}

async function doSendReaction(emoji) {
  try {
    await set(ref(db,`rooms/${S.roomId}/chat/${genId()}`),{
      pid:S.playerId, name:S.playerName, reaction:emoji, isBot:false, ts:Date.now()
    });
  } catch(e){}
}

function toggleChat() {
  S.chatCollapsed=!S.chatCollapsed;
  document.querySelector('.chat-panel')?.classList.toggle('collapsed',S.chatCollapsed);
  if(!S.chatCollapsed){
    S.chatUnread=0;
    document.getElementById('chat-unread-badge')?.classList.remove('show');
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
  if(roomData){
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
  const vc={}; players.forEach(p=>{vc[p.id]=0;});
  Object.values(room.round?.votes||{}).forEach(id=>{if(id&&id!=='abstain'&&vc[id]!==undefined)vc[id]++;});
  const maxV=Math.max(1,...Object.values(vc));
  const grid=document.getElementById('vote-grid');
  grid.style.gridTemplateColumns='1fr';
  grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;font-family:'Bebas Neue';font-size:.8rem;color:var(--red);opacity:.7;padding:6px 0;">👻 BẠN ĐÃ BỊ LOẠI — ĐANG XEM</div>
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
  } catch(e){toast('Lỗi: '+e.message);S.votedThisRound=false;}
  finally{loading(false);}
}

// ------------------------------------------------
//  RESOLVE VOTES
// ------------------------------------------------
function resolveVotesTx(room) {
  const players=Object.values(room.players||{});
  const vc={}; players.forEach(p=>{vc[p.id]=0;});
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
      if(!room||room.status!=='spyguess'||room.round.spyId!==S.playerId) return room;
      const ans=room.round.wordA.toLowerCase(), g=guess.trim().toLowerCase();
      const correct=g===ans||ans.includes(g)||g.includes(ans);
      const players=Object.values(room.players||{});
      room.round.spyGuess=guess;
      if(correct){room.round.result='spy';const spy=room.players[room.round.spyId];if(spy)spy.score=(spy.score||0)+3;}
      else{room.round.result='villagers';players.filter(p=>p.id!==room.round.spyId).forEach(p=>{p.score=(p.score||0)+1;});}
      room.status='result'; return room;
    });
  } catch(e){toast('Lỗi: '+e.message);S.spyGuessSubmitted=false;}
  finally{loading(false);}
}

// ------------------------------------------------
//  LEARN — ✅ FIX BUG 1: ghi bot_memory đúng
// ------------------------------------------------
async function sendLearnPayload(room) {
  try {
    const rd=room.round, players=room.playerList||Object.values(room.players||{});
    const bots=players.filter(p=>p.isBot);
    if(!bots.length) return;
    const gameId=S.roomId+'_'+(room.roundNumber||0);
    const allNames=players.map(p=>p.name);

    const botsPayload=bots.map(bot=>{
      const isSpy=bot.id===rd.spyId;
      const votedForId=rd.votes?.[bot.id]||null;
      const votedForName=votedForId?(players.find(p=>p.id===votedForId)?.name||null):null;
      const wasVotedBy=Object.entries(rd.votes||{})
        .filter(([,tid])=>tid===bot.id).map(([pid])=>players.find(p=>p.id===pid)?.name||pid);

      // ✅ Đảm bảo actions luôn có dữ liệu, kể cả khi log rỗng
      const rawActions = _botActionLog[bot.id] || [];
      const actions = rawActions.map(a=>({
        type: a.type,
        text: a.text,
        suspectName: a.suspectName || ''
      }));

      return {
        botName:    bot.name,
        role:       isSpy ? 'spy' : 'villager',
        won:        rd.result === (isSpy ? 'spy' : 'villagers'),
        word:       isSpy ? rd.wordB : rd.wordA,
        wordA:      rd.wordA,
        wordB:      rd.wordB,
        actions,
        votedFor:      votedForName,
        _votedForId:   votedForId,
        wasVotedBy,
        spyId:         rd.spyId
      };
    });

    sendActionToGAS({
      action:      'learn',
      gameId,
      playerList:  players.map(p=>p.name),
      keywordList: [rd.wordA, rd.wordB].filter(Boolean),
      allNames,
      bots:        botsPayload
    });
  } catch(e) { console.warn('sendLearnPayload error:',e); }
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
  if(room.hostId===S.playerId) sendLearnPayload(room);
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
  } catch(e){toast('Lỗi: '+e.message);}
  finally{loading(false);}
}

async function doLeave() {
  stopListening();
  if(S.timerInterval)      clearInterval(S.timerInterval);
  if(S.voteTimerInterval)  clearInterval(S.voteTimerInterval);
  if(_summaryTimer)        clearInterval(_summaryTimer);
  if(_botBattleAdvanceTimer){clearTimeout(_botBattleAdvanceTimer);_botBattleAdvanceTimer=null;}
  _botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];
  clearBotActionLog();
  clearSuspicion();
  const{roomId,playerId,isObserver}=S;
  S.roomId=''; S.playerId=''; S.playerName=''; S.myWord=null;
  S.earlyVoted=false; S.earlyVoteChoice=null; S.votedThisRound=false;
  S._inDiscussion=false; S.timerRunning=false;
  S.isBotBattle=false; S.isObserver=false;
  _autoBotVoteDone=false; _autoBotSpyGuessDone=false;
  try{localStorage.removeItem('gd_fb1');}catch(e){}
  if(roomId&&playerId&&!isObserver){
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
//  BOT BATTLE OVERLAY
// ------------------------------------------------
function injectBotBattleOverlay(room) {
  removeBotBattleOverlay();
  const rd = room.round || {};
  const players = room.playerList || Object.values(room.players||{});
  const spy = players.find(p => p.id === rd.spyId);
  const el = document.createElement('div');
  el.id = 'bb-overlay';
  el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:400;background:rgba(20,20,30,.92);border:1px solid var(--gray3);border-radius:10px;padding:10px 14px;font-size:.8rem;max-width:200px;pointer-events:none;';
  el.innerHTML = `
    <div style="font-family:'Bebas Neue';letter-spacing:.08em;color:var(--yellow);margin-bottom:4px">🕵️ SPY INFO</div>
    <div>Spy: <b>${esc(spy?.name||'?')}</b></div>
    <div>Từ dân: <b style="color:var(--green)">${esc(rd.wordA||'?')}</b></div>
    <div>Từ spy: <b style="color:var(--red)">${esc(rd.wordB||'?')}</b></div>
    <div class="bb-active-count" style="color:var(--cream);opacity:.7;margin-top:4px"></div>
  `;
  document.body.appendChild(el);
}

function updateBotBattleOverlay(room) {
  const el = document.getElementById('bb-overlay');
  if (!el) { injectBotBattleOverlay(room); return; }
  const players = room.playerList || Object.values(room.players||{});
  const activeCount = players.filter(p => !p.eliminated).length;
  const d = el.querySelector('.bb-active-count');
  if (d) d.textContent = `Còn lại: ${activeCount} người`;
}

function removeBotBattleOverlay() {
  document.getElementById('bb-overlay')?.remove();
}

// ------------------------------------------------
//  BOT BATTLE CHAT LISTENER
// ------------------------------------------------
function startBotChatListener() {
  if (S.chatListener) S.chatListener();
  const r = chatRef();
  const msgs = document.getElementById('bb-chat-messages');
  if (msgs) msgs.innerHTML = '';
  const cutoff = _lastRoom?.round?.chatStartTs || _lastRoom?.round?.discussStartAt || 0;
  let _renderedIds = new Set();
  _bbChatLog = [];

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
      // Cập nhật suspicion từ tin nhắn mới
      if (m.pid && m.text && _lastRoom) {
        const allPlayers = Object.values(_lastRoom.players||{});
        const allIds = allPlayers.map(p=>p.id);
        let actionType = 'hint';
        const t = (m.text||'').toLowerCase();
        if (/nghi|tố|đó là|chắc chắn|rõ ràng là/.test(t) &&
            allPlayers.some(p=>p.name&&t.includes(p.name.toLowerCase()))) actionType = 'accuse';
        else if (/oan|không phải tôi|tôi biết|mình biết|sai rồi/.test(t)) actionType = 'defend';
        else if (t.split(/\s+/).length < 5) actionType = 'react';
        let targetId = null;
        if (actionType === 'accuse') {
          const mentioned = allPlayers.find(p => p.id !== m.pid && p.name && t.includes(p.name.toLowerCase()));
          if (mentioned) targetId = mentioned.id;
        }
        updateSuspicion(m.pid, actionType, m.text, targetId, allIds, _lastRoom.round);
      }
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
  const defaultEmoji = m.isBot ? '🤖' : '😊';
  let avatarHtml = defaultEmoji;
  if (playerData?.avatarUrl) {
    const url = fixDriveUrl(playerData.avatarUrl);
    avatarHtml = `<img src="${url}" class="chat-avatar-img" onerror="this.outerHTML='<span>${defaultEmoji}</span>'">`;
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
  // ✅ FIX BUG 1: Dùng showBubble (đúng tên), không phải showBotBubble (undefined)
  const txt = m.text || m.reaction || '';
  showBubble(m.pid, txt.length > 40 ? txt.slice(0, 40) + '…' : txt, 4000);
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
window.doCreateBotBattle=doCreateBotBattle;
window.toggleBotChat=toggleBotChat; window.removeBotBattleOverlay=removeBotBattleOverlay;
