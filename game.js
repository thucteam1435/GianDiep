import { initializeApp } from “https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js”;
import { getDatabase, ref, set, get, update, onValue, off, runTransaction }
from “https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js”;

// ════════════════════════════════════════════════
//  ⚙️  CẤU HÌNH — điền vào đây
// ════════════════════════════════════════════════
const FIREBASE_CONFIG = {
apiKey: “AIzaSyBwl9j1V_PEP_5etnhhAUR1UUU3bfpx8uI”,
authDomain: “friendgame-63fb3.firebaseapp.com”,
databaseURL: “https://friendgame-63fb3-default-rtdb.asia-southeast1.firebasedatabase.app”,
projectId: “friendgame-63fb3”,
storageBucket: “friendgame-63fb3.firebasestorage.app”,
messagingSenderId: “675984454167”,
appId: “1:675984454167:web:33e0e76b154dc1c409a252”
};
const GAS_URL = “https://script.google.com/macros/s/AKfycbwGfPyXJcgay2MdZQI0bSezduzfJZZPVv_ZIS18gK-E2xYdLL5g5ZuoXJsCvkXpYxZb/exec”;

// ════════════════════════════════════════════════
//  FIREBASE INIT
// ════════════════════════════════════════════════
const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ════════════════════════════════════════════════
//  KEYWORDS
// ════════════════════════════════════════════════
let _keywords = null;
async function getKeywords() {
if (_keywords) return _keywords;
try {
const snap = await get(ref(db, ‘keywords’));
if (snap.exists()) {
const val = snap.val();
_keywords = Array.isArray(val) ? val : Object.values(val);
return _keywords;
}
} catch(e) { console.warn(‘keywords error:’, e); }
_keywords = [
[“Táo”,“Lê”,“Mận”,“Đào”], [“Cam”,“Quýt”,“Bưởi”,“Chanh”],
[“Bệnh viện”,“Phòng khám”,“Trạm y tế”,“Nhà thuốc”],
[“Cà phê đen”,“Cà phê sữa”,“Cà phê latte”,“Capuccino”],
[“Nhà hàng”,“Quán ăn”,“Quán cơm”,“Quán phở”],
];
toast(‘⚠️ Dùng từ khoá tạm’);
return _keywords;
}

// ════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════
const S = {
roomId:’’, playerId:’’, playerName:’’, myWord:null,
roomListener:null, chatListener:null,
timerInterval:null, timerRemaining:120, timerRunning:false,
selectedVote:null, earlyVoteChoice:null, earlyVoted:false,
votedThisRound:false, voteTimerInterval:null,
cardFlipped:false, cardConfirmed:false, spyGuessSubmitted:false,
chatCollapsed:true, chatUnread:0,
_lastRound:null, _lastStatus:null,
};
let _wordPickedUp = false;

// ════════════════════════════════════════════════
//  PERSIST
// ════════════════════════════════════════════════
function save() {
try { localStorage.setItem(‘gd_fb1’, JSON.stringify(
{roomId:S.roomId, playerId:S.playerId, playerName:S.playerName, myWord:S.myWord}
)); } catch(e) {}
}
function load() {
try {
const d = JSON.parse(localStorage.getItem(‘gd_fb1’)||‘null’);
if (d) { S.roomId=d.roomId||’’; S.playerId=d.playerId||’’; S.playerName=d.playerName||’’; S.myWord=d.myWord||null; }
} catch(e) {}
}

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function genRoomCode() {
const c=“ABCDEFGHJKLMNPQRSTUVWXYZ23456789”;
return Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join(’’);
}
function genId() { return Math.random().toString(36).slice(2,10); }
function randItem(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function loading(on) { document.getElementById(‘loading’).classList.toggle(‘show’,on); }
let _tt;
function toast(msg,dur=3000){
const el=document.getElementById(‘toast’);
el.textContent=msg; el.classList.add(‘show’);
clearTimeout(_tt); _tt=setTimeout(()=>el.classList.remove(‘show’),dur);
}
function esc(s){ return String(s).replace(/&/g,’&’).replace(/</g,’<’).replace(/>/g,’>’); }

// ════════════════════════════════════════════════
//  ROUTER
// ════════════════════════════════════════════════
function nav(screen, params) {
const qs = params ? ‘?’+Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join(’&’) : ‘’;
location.hash = screen + qs;
}
function parseHash() {
const raw = location.hash.replace(/^#/,’’)||‘home’;
const [screen, qs=’’] = raw.split(’?’);
const params = {};
if (qs) qs.split(’&’).forEach(p=>{ const [k,…vs]=p.split(’=’); if(k) params[k]=decodeURIComponent(vs.join(’=’)); });
return {screen,params};
}
window.addEventListener(‘hashchange’, ()=>{
const {screen,params} = parseHash();
showScreen(screen);
if (screen===‘join’&&params.room) { const el=document.getElementById(‘join-code’); if(el) el.value=params.room; }
});
function showScreen(name) {
document.querySelectorAll(’.screen’).forEach(s=>s.classList.remove(‘active’));
(document.getElementById(‘screen-’+name)||document.getElementById(‘screen-home’)).classList.add(‘active’);
window.scrollTo(0,0);
}
function copyJoinLink() {
const link = location.href.split(’#’)[0]+’#join?room=’+S.roomId;
navigator.clipboard ? navigator.clipboard.writeText(link).then(()=>toast(‘✓ Đã copy link!’))
: prompt(‘Copy link:’,link);
}

// ════════════════════════════════════════════════
//  FIREBASE HELPERS
// ════════════════════════════════════════════════
function roomRef(id)   { return ref(db,`rooms/${id||S.roomId}`); }
function playerRef(rid,pid) { return ref(db,`rooms/${rid}/players/${pid}`); }
function chatRef()     { return ref(db,`rooms/${S.roomId}/chat`); }

async function getRoom(roomId) {
const snap = await get(roomRef(roomId||S.roomId));
return snap.exists() ? snap.val() : null;
}

// ════════════════════════════════════════════════
//  REALTIME LISTENER
// ════════════════════════════════════════════════
function listenRoom(roomId) {
stopListening();
const r = ref(db,`rooms/${roomId}`);
const unsub = onValue(r, snap => {
if (!snap.exists()) { toast(‘Phòng không tồn tại.’); doLeave(); return; }
const room = snap.val();
room.playerList = room.players ? Object.values(room.players) : [];
handleRoomUpdate(room);
});
S.roomListener = () => off(r,‘value’,unsub);
}
function stopListening() {
if (S.roomListener) { S.roomListener(); S.roomListener=null; }
if (S.chatListener) { S.chatListener(); S.chatListener=null; }
}

// ════════════════════════════════════════════════
//  ROOM UPDATE HANDLER
// ════════════════════════════════════════════════
function handleRoomUpdate(room) {
tryPickUpWord(room);

if (room.status===‘playing’ && room.roundNumber!==S._lastRound) {
S._lastRound=room.roundNumber;
S.cardFlipped=false; S.cardConfirmed=false;
S.votedThisRound=false; S.earlyVoted=false; S.earlyVoteChoice=null;
S.spyGuessSubmitted=false; _wordPickedUp=false;
}

const status=room.status, cur=parseHash().screen;

if (status===‘waiting’) {
if (cur!==‘lobby’) nav(‘lobby’,{room:S.roomId});
renderLobby(room); return;
}
if (status===‘playing’) {
if (!S.myWord) fetchMyWord(room);
if (cur!==‘card’) showCardScreen(room); else updateCardConfirmCount(room);
return;
}
if (status===‘discussing’) {
if (cur!==‘discussion’) { startDiscussionScreen(room); }
else { updateTableAvatars(room); updateDiscVoteStatus(room); }
return;
}
if (status===‘voting’) {
if (cur!==‘vote’) {
S.votedThisRound=false;
renderVote(room); nav(‘vote’,{room:S.roomId}); startVoteTimer(room);
} else { updateVoteStatus(room); }
return;
}
if (status===‘votesummary’) {
if (cur!==‘votesummary’) showVoteSummary(room); return;
}
if (status===‘spyguess’) {
if (cur!==‘spyguess’) showSpyGuess(room); return;
}
if (status===‘result’) {
if (cur!==‘result’) showResult(room); return;
}
}

// ════════════════════════════════════════════════
//  WORD PICKUP
// ════════════════════════════════════════════════
async function fetchMyWord(room) {
const saved = S.myWord;
if (saved) { updateWordDisplay(); return; }
try {
const snap = await get(ref(db,`words/${S.roomId}/${S.playerId}`));
if (snap.exists()) { S.myWord=snap.val(); save(); updateWordDisplay(); showCardScreen(room); }
} catch(e) {}
}
function updateWordDisplay() {
const el=document.getElementById(‘cf-word’); if(el&&S.myWord) el.textContent=S.myWord;
const el2=document.getElementById(‘tb-word-display’); if(el2) el2.textContent=S.myWord||’—’;
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

// ════════════════════════════════════════════════
//  CLEAN OLD ROOMS
// ════════════════════════════════════════════════
async function cleanOldRooms() {
try {
const snap=await get(ref(db,‘rooms’)); if(!snap.exists()) return;
const cutoff=Date.now()-6*60*60*1000, updates={};
snap.forEach(c=>{ if((c.val().createdAt||0)<cutoff) updates[‘rooms/’+c.key]=null; });
if (Object.keys(updates).length) await update(ref(db),updates);
} catch(e){}
}

// ════════════════════════════════════════════════
//  CREATE / JOIN
// ════════════════════════════════════════════════
async function doCreateRoom() {
const name=document.getElementById(‘create-name’).value.trim();
if (!name) { toast(‘Hãy nhập tên!’); return; }
loading(true);
try {
await cleanOldRooms();
let roomId,exists;
do { roomId=genRoomCode(); exists=(await get(roomRef(roomId))).exists(); } while(exists);
const playerId=genId();
S.roomId=roomId; S.playerId=playerId; S.playerName=name; S.myWord=null; save();
await set(roomRef(roomId),{
id:roomId, createdAt:Date.now(), status:‘waiting’, hostId:playerId, roundNumber:0,
players:{[playerId]:{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false}}
});
listenRoom(roomId); nav(‘lobby’,{room:roomId});
} catch(e){toast(’❌ Lỗi: ’+e.message);console.error(e);}
finally{loading(false);}
}
async function doJoinRoom() {
const code=document.getElementById(‘join-code’).value.trim().toUpperCase();
const name=document.getElementById(‘join-name’).value.trim();
if (!code||code.length!==4) { toast(‘Nhập mã 4 ký tự!’); return; }
if (!name) { toast(‘Hãy nhập tên!’); return; }
loading(true);
try {
const room=await getRoom(code);
if (!room) { toast(‘Không tìm thấy phòng!’); return; }
if (room.status!==‘waiting’) { toast(‘Game đã bắt đầu!’); return; }
const players=Object.values(room.players||{});
if (players.length>=8) { toast(‘Phòng đầy!’); return; }
if (players.some(p=>p.name.toLowerCase()===name.toLowerCase())) { toast(‘Tên đã dùng!’); return; }
const playerId=genId();
S.roomId=code; S.playerId=playerId; S.playerName=name; S.myWord=null; save();
await set(playerRef(code,playerId),{id:playerId,name,ready:false,score:0,isBot:false,cardConfirmed:false});
listenRoom(code); nav(‘lobby’,{room:code});
} catch(e){toast(’❌ ’+e.message);console.error(e);}
finally{loading(false);}
}

// ════════════════════════════════════════════════
//  LOBBY
// ════════════════════════════════════════════════
function renderLobby(room) {
const players=room.playerList||Object.values(room.players||{});
document.getElementById(‘lobby-code’).textContent=room.id;
document.getElementById(‘lobby-count’).textContent=players.length;
const me=players.find(p=>p.id===S.playerId);
const iAmReady=me?.ready||false, isHost=room.hostId===S.playerId;
const botCount=players.filter(p=>p.isBot).length;
document.getElementById(‘lobby-player-list’).innerHTML=players.map(p=>{
const b=[];
if(p.id===room.hostId) b.push(’<span class="pbadge host-badge">HOST</span>’);
if(p.isBot)            b.push(’<span class="pbadge bot-badge">🤖 BOT</span>’);
if(p.id===S.playerId)  b.push(’<span class="pbadge you-badge">BẠN</span>’);
b.push(p.ready?’<span class="pbadge ready-badge">✓ SẴN SÀNG</span>’:’<span class="pbadge wait-badge">CHỜ…</span>’);
return `<div class="player-row${p.isBot?' bot-row':''}"><span class="pname">${esc(p.name)}</span><span style="display:flex;gap:5px">${b.join('')}</span></div>`;
}).join(’’);
const btn=document.getElementById(‘btn-ready’);
if (iAmReady){btn.textContent=‘✕ HỦY’;btn.className=‘btn full red’;} else {btn.textContent=‘✓ SẴN SÀNG’;btn.className=‘btn full green’;}
btn.style.maxWidth=‘320px’;
document.getElementById(‘bot-buttons’).classList.toggle(‘hidden’,!isHost);
document.getElementById(‘btn-remove-bot’).classList.toggle(‘hidden’,!(isHost&&botCount>0));
const readyCount=players.filter(p=>p.ready).length;
const st=document.getElementById(‘lobby-status-text’);
if(players.length<3){st.textContent=`Cần ít nhất 3 người (hiện có ${players.length})`;st.className=‘muted dots’;}
else if(readyCount<players.length){st.textContent=`${readyCount}/${players.length} đã sẵn sàng...`;st.className=‘muted dots’;}
else{st.textContent=‘Tất cả sẵn sàng! Đang bắt đầu…’;st.className=‘muted’;}
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
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);}
finally{loading(false);}
}
async function doAddBot() {
loading(true);
try {
const kw=await getKeywords();
await runTransaction(roomRef(),room=>{
if(!room||room.status!==‘waiting’) return room;
const players=Object.values(room.players||{});
if(players.length>=8){toast(‘Phòng đầy!’);return room;}
const botNames=[“Bot Alpha”,“Bot Beta”,“Bot Gamma”,“Bot Delta”,“Bot Epsilon”,“Bot Zeta”];
const used=players.map(p=>p.name);
const name=botNames.find(n=>!used.includes(n))||(’Bot ’+genId().slice(0,4));
const botId=‘bot_’+genId();
room.players[botId]={id:botId,name,ready:true,score:0,isBot:true,cardConfirmed:false};
if(Object.values(room.players).length>=3&&Object.values(room.players).every(p=>p.ready)) beginRoundTx(room,kw);
return room;
});
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);}
finally{loading(false);}
}
async function doRemoveBot() {
loading(true);
try {
await runTransaction(roomRef(),room=>{
if(!room) return room;
const bot=[…Object.values(room.players||{})].reverse().find(p=>p.isBot);
if(bot) delete room.players[bot.id];
return room;
});
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);}
finally{loading(false);}
}

// ════════════════════════════════════════════════
//  BEGIN ROUND
// ════════════════════════════════════════════════
function beginRoundTx(room,keywords) {
const row=randItem(keywords), shuffled=[…row].sort(()=>Math.random()-.5);
const wordA=shuffled[0], wordB=shuffled[1];
const players=Object.values(room.players), spy=randItem(players);
room.status=‘playing’; room.roundNumber=(room.roundNumber||0)+1;
room.round={wordA,wordB,spyId:spy.id,votes:{},voteCounts:{},spyGuess:null,result:null,discussStartAt:null,discussDuration:120};
room._wordAssignments={};
players.forEach(p=>{
room._wordAssignments[p.id]=(p.id===spy.id)?wordB:wordA;
p.cardConfirmed=!!p.isBot; p.ready=false; p.eliminated=false;
});
if(players.every(p=>p.cardConfirmed)){
room.status=‘discussing’; room.round.discussStartAt=Date.now(); delete room._wordAssignments;
}
return room;
}

// ════════════════════════════════════════════════
//  CARD
// ════════════════════════════════════════════════
function showCardScreen(room) {
const el=document.getElementById(‘cf-word’); if(el) el.textContent=S.myWord||’…’;
updateCardConfirmCount(room);
document.getElementById(‘card-wrap’).classList.remove(‘flipped’);
document.getElementById(‘btn-confirm-card’).disabled=true;
document.getElementById(‘btn-confirm-card’).textContent=‘ĐÃ GHI NHỚ ✓’;
document.getElementById(‘card-waiting-others’).style.display=‘none’;
nav(‘card’,{room:S.roomId});
}
function updateCardConfirmCount(room) {
const players=room.playerList||Object.values(room.players||{});
const humans=players.filter(p=>!p.isBot), confirmed=humans.filter(p=>p.cardConfirmed).length;
const el=document.getElementById(‘card-confirm-count’); if(el) el.textContent=`${confirmed}/${humans.length} người đã xem xong`;
}
function flipCard() {
if(!S.cardFlipped){S.cardFlipped=true;document.getElementById(‘card-wrap’).classList.add(‘flipped’);document.getElementById(‘btn-confirm-card’).disabled=false;updateWordDisplay();}
}
async function doConfirmCard() {
if(!S.cardFlipped){toast(‘Hãy lật thẻ trước!’);return;}
S.cardConfirmed=true;
document.getElementById(‘btn-confirm-card’).disabled=true;
document.getElementById(‘btn-confirm-card’).textContent=‘✓ ĐÃ GHI NHỚ’;
document.getElementById(‘card-waiting-others’).style.display=‘block’;
await runTransaction(roomRef(),room=>{
if(!room?.players?.[S.playerId]) return room;
room.players[S.playerId].cardConfirmed=true;
if(Object.values(room.players).every(p=>p.cardConfirmed)){
room.status=‘discussing’; room.round.discussStartAt=Date.now();
}
return room;
});
}

// ════════════════════════════════════════════════
//  ██████╗  ██████╗ ██╗   ██╗███╗   ██╗██████╗
//  ██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔══██╗
//  ██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║  ██║
//  ██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║  ██║
//  ██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝
//  TABLE SCREEN  (replaces discussion screen)
// ════════════════════════════════════════════════

let _botHintTimers = [];
let _lastRoom = null;

function startDiscussionScreen(room) {
const alreadyOnScreen=parseHash().screen===‘discussion’;
if (alreadyOnScreen && S.timerRunning) return;

_lastRoom = room;
S.earlyVoteChoice=null;
S.earlyVoted=!!(room.round?.earlyVotes?.[S.playerId]);

// Top bar
document.getElementById(‘tb-round-badge’).textContent=‘VÒNG ‘+(room.roundNumber||1);
document.getElementById(‘tb-word-display’).textContent=S.myWord||’—’;

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
if(S.timerRemaining===0){clearInterval(S.timerInterval);S.timerRunning=false;doTimeUpVoting();}
},1000);

// Tie notice
const tie=document.getElementById(‘table-tie-banner’);
if(tie) tie.style.display=room.round?.isTie?‘block’:‘none’;

// Build table
buildRoundTable(room);

// Chỉ start chat khi vào màn hình mới
if(!alreadyOnScreen||!S.chatListener) startChatListener();
scheduleBotHints(room);

// Chat collapsed initially
S.chatCollapsed=true;
S.chatUnread=0;
document.querySelector(’.chat-panel’)?.classList.add(‘collapsed’);
document.getElementById(‘chat-unread-badge’).classList.remove(‘show’);

nav(‘discussion’,{room:S.roomId});
}

function updateTableTimer() {
const m=Math.floor(S.timerRemaining/60), s=S.timerRemaining%60;
const el=document.getElementById(‘tb-timer’);
if(!el) return;
el.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
el.classList.toggle(‘urgent’,S.timerRemaining<=30&&S.timerRemaining>0);
}

// ── Build round table layout ──
function buildRoundTable(room) {
const players=room.playerList||Object.values(room.players||{});
const n=players.length;
const tableEl=document.getElementById(‘round-table’);
if(!tableEl) return;

// Remove old player nodes
tableEl.querySelectorAll(’.table-player’).forEach(el=>el.remove());

const size=tableEl.offsetWidth||300;
const cx=size/2, cy=size/2, r=size*0.42;

players.forEach((p,i)=>{
const angle=(2*Math.PI*i/n)-Math.PI/2;
const x=cx+r*Math.cos(angle);
const y=cy+r*Math.sin(angle);

```
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
const emoji=p.isBot?'🤖':(isMe?'😊':['👤','🧑','👩','🙂','😐','🧐'][i%6]);
const hasVoted=!!(room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]);

wrap.innerHTML=`
  <div class="speech-bubble ${arrDir}" id="bubble-${p.id}"></div>
  <div class="avatar${isMe?' is-me':''}${p.eliminated?' eliminated':''}" id="avatar-${p.id}">
    ${emoji}
    <div class="avatar-voted-badge${hasVoted?' show':''}" id="voted-${p.id}">✓</div>
    ${p.eliminated?'<div class="avatar-elim-badge">✕</div>':''}
  </div>
  <div class="avatar-name${isMe?' is-me':''}">${esc(p.name)}</div>
`;
tableEl.appendChild(wrap);
```

});

// Update center text
const active=players.filter(p=>!p.eliminated).length;
document.getElementById(‘table-center-text’).textContent=`${active} người`;

updateDiscVoteStatus(room);
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
av.classList.toggle(‘eliminated’,!!p.eliminated);
if(p.eliminated&&!av.querySelector(’.avatar-elim-badge’)){
const x=document.createElement(‘div’);x.className=‘avatar-elim-badge’;x.textContent=‘✕’;av.appendChild(x);
}
}
if(vb) vb.classList.toggle(‘show’,hasVoted);
});
updateDiscVoteStatus(room);
}

// ── Vote status below table ──
function updateDiscVoteStatus(room) {
if(!room) return;
const players=room.playerList||Object.values(room.players||{});
const humans=players.filter(p=>!p.isBot&&!p.eliminated);
const voted=humans.filter(p=>room.round?.earlyVotes?.[p.id]||room.round?.votes?.[p.id]).length;
const el=document.getElementById(‘disc-voted-count’);
if(el) el.textContent=voted===humans.length?`✓ Tất cả ${humans.length} người đã vote`:`${voted}/${humans.length} người đã gửi phiếu`;

// Show/hide early vote panel
const me=players.find(p=>p.id===S.playerId);
const iAmEliminated=me?.eliminated||false;
const earlyPanel=document.getElementById(‘disc-early-vote-section’);
if(earlyPanel){
if(iAmEliminated||S.earlyVoted) earlyPanel.style.display=‘none’;
else earlyPanel.style.display=’’;
}
const votedNotice=document.getElementById(‘disc-voted-notice’);
if(votedNotice) votedNotice.style.display=(S.earlyVoted&&!iAmEliminated)?‘block’:‘none’;
}

function renderDiscVoteGrid(room) {
const players=room.playerList||Object.values(room.players||{});
const grid=document.getElementById(‘disc-vote-grid’);
if(!grid) return;
grid.innerHTML=’’;
S.earlyVoteChoice=null;
const btn=document.getElementById(‘disc-btn-vote’);
if(btn) btn.disabled=true;

players.filter(p=>!p.eliminated).forEach(p=>{
const b=document.createElement(‘button’);
b.className=‘vote-opt’;
b.textContent=(p.isBot?‘🤖 ‘:’’)+p.name+(p.id===S.playerId?’ (bạn)’:’’);
b.onclick=()=>{
grid.querySelectorAll(’.vote-opt’).forEach(x=>x.classList.remove(‘sel’));
b.classList.add(‘sel’); S.earlyVoteChoice=p.id; if(btn) btn.disabled=false;
};
grid.appendChild(b);
});
const ab=document.createElement(‘button’);
ab.className=‘vote-opt abstain’; ab.textContent=‘Bỏ phiếu trắng’;
ab.onclick=()=>{
grid.querySelectorAll(’.vote-opt’).forEach(x=>x.classList.remove(‘sel’));
ab.classList.add(‘sel’); S.earlyVoteChoice=‘abstain’; if(btn) btn.disabled=false;
};
grid.appendChild(ab);
}

async function doEarlyVote() {
if(!S.earlyVoteChoice){toast(‘Hãy chọn!’);return;}
S.earlyVoted=true; loading(true);
try {
await runTransaction(roomRef(),room=>{
if(!room||room.status!==‘discussing’) return room;
if(!room.round.earlyVotes) room.round.earlyVotes={};
room.round.earlyVotes[S.playerId]=S.earlyVoteChoice;
const players=Object.values(room.players||{});
const humans=players.filter(p=>!p.isBot&&!p.eliminated);
if(humans.every(p=>room.round.earlyVotes[p.id])){
room.round.votes={…room.round.earlyVotes};
players.filter(p=>p.isBot&&!p.eliminated).forEach(bot=>{
const others=players.filter(p=>p.id!==bot.id&&!p.eliminated);
if(others.length) room.round.votes[bot.id]=randItem(others).id;
});
delete room.round.earlyVotes; resolveVotesTx(room);
}
return room;
});
// Show bubble for myself
showBubble(S.playerId,‘✓ Đã gửi phiếu’,3000);
updateDiscVoteStatus(_lastRoom||{round:{},players:{}});
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);S.earlyVoted=false;}
finally{loading(false);}
}

// ── Show speech bubble on avatar ──
function showBubble(playerId, text, dur=4000) {
const el=document.getElementById(`bubble-${playerId}`);
if(!el) return;
el.textContent=text; el.classList.add(‘show’);
setTimeout(()=>el.classList.remove(‘show’),dur);
}

// ── Mark avatar as speaking ──
function setAvatarSpeaking(playerId, on) {
const el=document.getElementById(`avatar-${playerId}`);
if(el) el.classList.toggle(‘speaking’,on);
}

// ════════════════════════════════════════════════
//  BOT AI HINTS via Claude API
// ════════════════════════════════════════════════
function scheduleBotHints(room) {
_botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];
const players=room.playerList||Object.values(room.players||{});
const bots=players.filter(p=>p.isBot&&!p.eliminated);
if(!bots.length) return;
const duration=(room.round?.discussDuration||120)*1000;

bots.forEach(bot=>{
// Schedule 1-3 random hints per bot during discussion
const numHints=1+Math.floor(Math.random()*2);
const used=new Set();
for(let i=0;i<numHints;i++){
let delay;
do { delay=8000+Math.random()*(duration*0.75); } while(used.has(Math.floor(delay/5000)));
used.add(Math.floor(delay/5000));
const t=setTimeout(()=>triggerBotHint(bot,room),delay);
_botHintTimers.push(t);
}
});
}

async function triggerBotHint(bot, room) {
if(parseHash().screen!==‘discussion’) return;
// Fix: dùng wordA/B trực tiếp, không dùng _wordAssignments (đã bị xóa)
const isSpy=bot.id===room.round?.spyId;
const word=isSpy ? room.round?.wordB : room.round?.wordA;
setAvatarSpeaking(bot.id,true);
try {
const hint=await callGAS({action:‘hint’,botName:bot.name,word,isSpy,wordA:room.round?.wordA,wordB:room.round?.wordB});
showBubble(bot.id,hint,5000);
postBotChat(bot,hint);
} catch(e){
const fallbacks=isSpy?
[‘Hmm…’,‘Tôi biết rồi…’,‘Thú vị…’,‘Có vẻ quen…’]:
[‘Đúng rồi!’,‘Tôi hiểu từ này’,‘Khá rõ ràng’,‘Tôi chắc chắn’];
const hint=randItem(fallbacks);
showBubble(bot.id,hint,4000);
postBotChat(bot,hint);
}
setTimeout(()=>setAvatarSpeaking(bot.id,false),5500);
}

async function callGAS(payload) {
const resp=await fetch(GAS_URL,{method:‘POST’,headers:{‘Content-Type’:‘text/plain’},body:JSON.stringify(payload)});
if(!resp.ok) throw new Error(‘GAS ‘+resp.status);
const data=await resp.json();
return data.text?.trim()||’…’;
}

async function getBotVoteTarget(bot, room) {
const players=Object.values(room.players||{});
const candidates=players.filter(p=>p.id!==bot.id&&!p.eliminated);
if(!candidates.length) return null;
try {
const chatSnap=await get(ref(db,`rooms/${S.roomId}/chat`));
let chatHistory=’’;
if(chatSnap.exists()){
const msgs=Object.values(chatSnap.val()).sort((a,b)=>a.ts-b.ts).slice(-10);
chatHistory=msgs.map(m=>`${m.name}: ${m.text||m.reaction||''}`).join(’
’);
}
const isSpy=bot.id===room.round?.spyId;
const myWord=isSpy?room.round?.wordB:room.round?.wordA;
const result=await callGAS({action:‘vote’,botName:bot.name,myWord,isSpy,wordA:room.round?.wordA,wordB:room.round?.wordB,candidates:candidates.map(p=>p.name),chatHistory});
const target=candidates.find(p=>p.name===result?.trim());
return target?.id||randItem(candidates).id;
} catch(e){
return randItem(candidates).id;
}
}

// ════════════════════════════════════════════════
//  CHAT
// ════════════════════════════════════════════════
const REACTIONS=[‘😂’,‘🤔’,‘😱’,‘👀’,‘🤥’,‘✅’];

function startChatListener() {
if(S.chatListener){S.chatListener();S.chatListener=null;}
const r=chatRef();
const msgs=document.getElementById(‘chat-messages’);
if(msgs) msgs.innerHTML=’’;

let _lastTs=0;
const unsub=onValue(r,snap=>{
if(!snap.exists()) return;
const sorted=Object.values(snap.val()||{}).sort((a,b)=>a.ts-b.ts);
const fresh=sorted.filter(m=>(m.ts||0)>_lastTs);
if(!fresh.length) return;
fresh.forEach(m=>{appendChatMsg(m);if((m.ts||0)>_lastTs)_lastTs=m.ts;});
if(msgs) msgs.scrollTop=msgs.scrollHeight;
if(S.chatCollapsed){
S.chatUnread+=fresh.length;
const badge=document.getElementById(‘chat-unread-badge’);
if(badge){badge.textContent=S.chatUnread>9?‘9+’:S.chatUnread;badge.classList.add(‘show’);}
}
});
S.chatListener=()=>off(r,‘value’,unsub);
}

function appendChatMsg(m) {
const msgs=document.getElementById(‘chat-messages’);
if(!msgs) return;
const isMe=m.pid===S.playerId;
const div=document.createElement(‘div’);
div.className=‘chat-msg’+(isMe?’ mine’:’’);
const emoji=m.isBot?‘🤖’:‘😊’;
div.innerHTML=` <div class="chat-msg-avatar">${emoji}</div> <div class="chat-msg-body"> <div class="chat-msg-name">${esc(m.name)}</div> ${m.reaction ?`<div class="chat-msg-reaction">${m.reaction}</div>` :`<div class="chat-msg-text">${esc(m.text||’’)}</div>`} </div>`;
msgs.appendChild(div);

// Also show bubble on avatar
if(m.text) showBubble(m.pid, m.text.length>40?m.text.slice(0,40)+’…’:m.text, 4000);
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
if(e&&e.key&&e.key!==‘Enter’) return;
const inp=document.getElementById(‘chat-inp’);
const text=inp?.value.trim(); if(!text) return;
inp.value=’’;
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
document.querySelector(’.chat-panel’)?.classList.toggle(‘collapsed’,S.chatCollapsed);
if(!S.chatCollapsed){
S.chatUnread=0;
const badge=document.getElementById(‘chat-unread-badge’);
if(badge) badge.classList.remove(‘show’);
const msgs=document.getElementById(‘chat-messages’);
if(msgs) setTimeout(()=>{msgs.scrollTop=msgs.scrollHeight;},100);
}
}

// ════════════════════════════════════════════════
//  TIME-UP VOTING
// ════════════════════════════════════════════════
async function doTimeUpVoting() {
if(S.timerInterval) clearInterval(S.timerInterval);
S.timerRunning=false;
_botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];
// Smart bot vote: đọc chat trước transaction
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
if(!room||room.status!==‘discussing’) return room;
room.status=‘voting’;
room.round.votes={…(room.round.earlyVotes||{})};
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

// ════════════════════════════════════════════════
//  VOTE SCREEN (overlay style, 10s timer)
// ════════════════════════════════════════════════
function renderVote(room) {
S.selectedVote=null;
const players=room.playerList||Object.values(room.players||{});
const me=players.find(p=>p.id===S.playerId);
const iAmEliminated=me?.eliminated||false;
const grid=document.getElementById(‘vote-grid’);
grid.innerHTML=’’;

if(iAmEliminated){
document.getElementById(‘btn-confirm-vote’).style.display=‘none’;
document.getElementById(‘vote-waiting’).style.display=‘none’;
renderSpectatorVotes(room);
} else {
document.getElementById(‘btn-confirm-vote’).style.display=’’;
document.getElementById(‘btn-confirm-vote’).disabled=true;
document.getElementById(‘vote-waiting’).style.display=‘none’;
players.filter(p=>!p.eliminated).forEach(p=>{
const btn=document.createElement(‘button’);
btn.className=‘vote-opt’;
btn.textContent=(p.isBot?‘🤖 ‘:’’)+p.name+(p.id===S.playerId?’ (bạn)’:’’);
btn.onclick=()=>{
document.querySelectorAll(’#vote-grid .vote-opt’).forEach(b=>b.classList.remove(‘sel’));
btn.classList.add(‘sel’); S.selectedVote=p.id;
document.getElementById(‘btn-confirm-vote’).disabled=false;
};
grid.appendChild(btn);
});
const ab=document.createElement(‘button’);
ab.className=‘vote-opt abstain’; ab.textContent=‘Bỏ phiếu trắng’;
ab.onclick=()=>{
document.querySelectorAll(’#vote-grid .vote-opt’).forEach(b=>b.classList.remove(‘sel’));
ab.classList.add(‘sel’); S.selectedVote=‘abstain’;
document.getElementById(‘btn-confirm-vote’).disabled=false;
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
const el=document.getElementById(‘vote-timer-display’);
if(el){el.textContent=rem;el.style.color=rem<=3?‘var(–red)’:‘var(–cream)’;}
if(rem===0){clearInterval(S.voteTimerInterval);if(!S.votedThisRound){S.selectedVote=‘abstain’;doVote();}}
}
tick(); S.voteTimerInterval=setInterval(tick,500);
}

function renderSpectatorVotes(room) {
const players=room.playerList||Object.values(room.players||{});
const vc={};
players.forEach(p=>{vc[p.id]=0;});
Object.values(room.round?.votes||{}).forEach(id=>{if(id&&id!==‘abstain’&&vc[id]!==undefined)vc[id]++;});
const maxV=Math.max(1,…Object.values(vc));
const grid=document.getElementById(‘vote-grid’);
grid.style.gridTemplateColumns=‘1fr’;
grid.innerHTML=` <div style="grid-column:1/-1;text-align:center;font-family:'Bebas Neue';letter-spacing:.2em;font-size:.8rem;color:var(--red);opacity:.7;padding:6px 0;">👻 BẠN ĐÃ BỊ LOẠI — ĐANG XEM</div> ${players.filter(p=>!p.eliminated).map(p=>`
<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--gray2);border:1px solid var(--gray3);">
<div style="flex:1"><div>${p.isBot?‘🤖 ‘:’’}${esc(p.name)}</div>
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
const el=document.getElementById(‘vote-status-text’);
if(el) el.textContent=`${voted}/${humans.length} người đã bỏ phiếu`;
if(iAmEliminated){renderSpectatorVotes(room);return;}
if(S.votedThisRound){
document.getElementById(‘btn-confirm-vote’).disabled=true;
document.getElementById(‘vote-waiting’).style.display=‘block’;
}
}

async function doVote() {
const choice=S.selectedVote||‘abstain’;
if(!S.selectedVote) toast(‘⏰ Hết giờ — tự bỏ phiếu trắng’);
if(S.votedThisRound) return;
S.votedThisRound=true; loading(true);
try {
await runTransaction(roomRef(),room=>{
if(!room||room.status!==‘voting’) return room;
room.round.votes[S.playerId]=choice;
const players=Object.values(room.players||{});
const humans=players.filter(p=>!p.isBot&&!p.eliminated);
if(humans.every(p=>room.round.votes[p.id])) resolveVotesTx(room);
return room;
});
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);S.votedThisRound=false;}
finally{loading(false);}
}

// ════════════════════════════════════════════════
//  RESOLVE VOTES
// ════════════════════════════════════════════════
function resolveVotesTx(room) {
const players=Object.values(room.players||{});
const vc={};
players.forEach(p=>{vc[p.id]=0;});
Object.values(room.round.votes||{}).forEach(id=>{if(id&&id!==‘abstain’&&vc[id]!==undefined)vc[id]++;});
const maxV=Math.max(0,…Object.values(vc));
const topIds=Object.entries(vc).filter(([,cnt])=>cnt===maxV).map(([id])=>id);
room.round.voteCounts=vc;

if(maxV===0||topIds.length>1){
room.round.isTie=true; room.round.eliminatedId=null; room.round.eliminatedName=null;
room.round._nextStatus=‘discussing’; room.status=‘votesummary’; return;
}
room.round.isTie=false;
const mostId=topIds[0];
room.round.mostVotedId=mostId; room.round.eliminatedId=mostId;
const eliminated=room.players[mostId];
room.round.eliminatedName=eliminated?.name||’?’;
if(eliminated) eliminated.eliminated=true;

if(mostId===room.round.spyId){
const spy=room.players[room.round.spyId];
if(spy?.isBot){
room.round.spyGuess=’???’; room.round.result=‘villagers’;
players.filter(p=>p.id!==room.round.spyId).forEach(p=>{p.score=(p.score||0)+1;});
room.round._nextStatus=‘result’;
} else { room.round._nextStatus=‘spyguess’; }
} else {
const active=players.filter(p=>!p.eliminated);
// Chỉ đếm dân thường thật (không tính bot) khi xét điều kiện thắng
const villagers=active.filter(p=>p.id!==room.round.spyId&&!p.isBot);
const spy=room.players[room.round.spyId];
if(villagers.length<=1){
room.round.result=‘spy’; room.round._nextStatus=‘result’;
if(spy) spy.score=(spy.score||0)+2;
} else { room.round._nextStatus=‘discussing’; }
}
room.status=‘votesummary’;
}

// ════════════════════════════════════════════════
//  VOTE SUMMARY
// ════════════════════════════════════════════════
let _summaryTimer=null;

function showVoteSummary(room) {
const rd=room.round, players=room.playerList||Object.values(room.players||{});
const vc=rd.voteCounts||{}, isTie=rd.isTie||false;
document.getElementById(‘vs-eliminated-box’).style.display=isTie?‘none’:’’;
document.getElementById(‘vs-tie-box’).style.display=isTie?’’:‘none’;
if(!isTie&&rd.eliminatedName) document.getElementById(‘vs-eliminated-name’).textContent=rd.eliminatedName;
const maxV=Math.max(1,…Object.values(vc).map(Number));
document.getElementById(‘vs-vote-list’).innerHTML=[…players]
.sort((a,b)=>(vc[b.id]||0)-(vc[a.id]||0))
.map(p=>`<div class="vr-row" style="${p.id===rd.eliminatedId?'border-color:var(--red);background:rgba(192,57,43,.08)':''}"> <div style="flex:1"><div>${p.isBot?'🤖 ':''}${esc(p.name)}${p.eliminated&&p.id!==rd.eliminatedId?' ❌':''}</div> <div class="vr-bar" style="width:${((vc[p.id]||0)/maxV)*100}%"></div></div> <div class="vr-count">${vc[p.id]||0}</div></div>`).join(’’);
if(_summaryTimer) clearInterval(_summaryTimer);
let cd=4;
document.getElementById(‘vs-countdown’).textContent=`Tiếp tục sau ${cd} giây`;
_summaryTimer=setInterval(()=>{
cd–;
if(cd>0) document.getElementById(‘vs-countdown’).textContent=`Tiếp tục sau ${cd} giây`;
else { clearInterval(_summaryTimer); if(room.hostId===S.playerId) advanceAfterSummary(); }
},1000);
nav(‘votesummary’,{room:S.roomId});
}

async function advanceAfterSummary() {
await runTransaction(roomRef(),room=>{
if(!room||room.status!==‘votesummary’) return room;
room.status=room.round._nextStatus||‘discussing’;
delete room.round._nextStatus;
if(room.status===‘discussing’){
room.round.discussStartAt=Date.now();
room.round.discussDuration=room.round.isTie?60:120;
room.round.votes={}; room.round.voteCounts={}; room.round.isTie=false;
}
return room;
});
}

// ════════════════════════════════════════════════
//  SPY GUESS
// ════════════════════════════════════════════════
function showSpyGuess(room) {
const players=room.playerList||Object.values(room.players||{});
const spy=players.find(p=>p.id===room.round.spyId);
document.getElementById(‘sg-spy-name’).textContent=(spy?.isBot?‘🤖 ‘:’’)+(spy?.name||‘Gián Điệp’);
const iAmSpy=room.round.spyId===S.playerId;
document.getElementById(‘sg-input-area’).style.display=iAmSpy?‘flex’:‘none’;
document.getElementById(‘sg-waiting’).style.display=iAmSpy?‘none’:‘block’;
document.getElementById(‘sg-input’).value=’’; S.spyGuessSubmitted=false;
nav(‘spyguess’,{room:S.roomId});
}

async function doSpyGuess() {
const guess=document.getElementById(‘sg-input’).value.trim();
if(!guess){toast(‘Nhập đáp án!’);return;}
if(S.spyGuessSubmitted) return;
S.spyGuessSubmitted=true; loading(true);
try {
await runTransaction(roomRef(),room=>{
if(!room||room.status!==‘spyguess’) return room;
if(room.round.spyId!==S.playerId) return room;
const ans=room.round.wordA.toLowerCase(), g=guess.trim().toLowerCase();
const correct=g===ans||ans.includes(g)||g.includes(ans);
const players=Object.values(room.players||{});
room.round.spyGuess=guess;
if(correct){room.round.result=‘spy’;const spy=room.players[room.round.spyId];if(spy)spy.score=(spy.score||0)+3;}
else{room.round.result=‘villagers’;players.filter(p=>p.id!==room.round.spyId).forEach(p=>{p.score=(p.score||0)+1;});}
room.status=‘result’; return room;
});
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);S.spyGuessSubmitted=false;}
finally{loading(false);}
}

// ════════════════════════════════════════════════
//  RESULT
// ════════════════════════════════════════════════
function showResult(room) {
const rd=room.round, players=room.playerList||Object.values(room.players||{});
const isWin=rd.result===‘villagers’;
document.getElementById(‘result-banner’).textContent=isWin?‘🎉 DÂN THƯỜNG THẮNG!’:‘🕵️ GIÁN ĐIỆP THẮNG!’;
document.getElementById(‘result-banner’).className=‘result-banner ‘+(isWin?‘win’:‘lose’);
document.getElementById(‘res-word-a’).textContent=rd.wordA||’—’;
document.getElementById(‘res-word-b’).textContent=rd.wordB||’—’;
const spy=players.find(p=>p.id===rd.spyId);
document.getElementById(‘res-spy’).textContent=(spy?.isBot?‘🤖 ‘:’’)+(spy?.name||’—’);
const vc=rd.voteCounts||{}, maxV=Math.max(1,…Object.values(vc).map(Number));
document.getElementById(‘res-votes’).innerHTML=players.map(p=>` <div class="vr-row"><div style="flex:1"> <div>${p.isBot?'🤖 ':''}${esc(p.name)}${p.id===rd.spyId?' 🕵️':''}${p.eliminated?' ❌':''}</div> <div class="vr-bar" style="width:${((vc[p.id]||0)/maxV)*100}%"></div> </div><div class="vr-count">${vc[p.id]||0}</div></div>`).join(’’);
document.getElementById(‘res-scores’).innerHTML=[…players].sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>` <tr><td>${p.isBot?'🤖 ':''}${esc(p.name)}${p.id===S.playerId?' <span style="color:var(--green);font-size:.75em">(bạn)</span>':''}</td> <td>${p.score||0} điểm</td></tr>`).join(’’);
document.getElementById(‘btn-next-round’).style.display=room.hostId===S.playerId?‘inline-flex’:‘none’;
nav(‘result’,{room:S.roomId});
}

// ════════════════════════════════════════════════
//  NEXT ROUND / LEAVE
// ════════════════════════════════════════════════
async function doNextRound() {
loading(true);
try {
await runTransaction(roomRef(),room=>{
if(!room||room.status!==‘result’) return room;
room.status=‘waiting’; S.myWord=null; _wordPickedUp=false; save();
Object.values(room.players||{}).forEach(p=>{p.ready=!!p.isBot;p.eliminated=false;p.cardConfirmed=false;});
room.round={votes:{},voteCounts:{},spyGuess:null,result:null};
return room;
});
} catch(e){toast(’Lỗi: ’+e.message);console.error(e);}
finally{loading(false);}
}

async function doLeave() {
stopListening();
if(S.timerInterval) clearInterval(S.timerInterval);
_botHintTimers.forEach(t=>clearTimeout(t)); _botHintTimers=[];
const{roomId,playerId}=S;
S.roomId=’’; S.playerId=’’; S.myWord=null;
try{localStorage.removeItem(‘gd_fb1’);}catch(e){}
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
nav(‘home’);
}

// ════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════
load();
const{screen:initScreen,params:initParams}=parseHash();
showScreen(initScreen);
if(initScreen===‘join’&&initParams.room){
const el=document.getElementById(‘join-code’); if(el) el.value=initParams.room;
}
if(S.roomId&&S.playerId&&![‘home’,‘create’,‘join’,‘rules’].includes(initScreen)) listenRoom(S.roomId);

// Build reaction picker
const rp=document.getElementById(‘reaction-picker’);
if(rp) REACTIONS.forEach(e=>{
const btn=document.createElement(‘button’);
btn.className=‘reaction-btn’; btn.textContent=e;
btn.onclick=()=>doSendReaction(e);
rp.appendChild(btn);
});

// ── EXPOSE GLOBALS ──
window.nav=nav; window.copyJoinLink=copyJoinLink; window.flipCard=flipCard;
window.doCreateRoom=doCreateRoom; window.doJoinRoom=doJoinRoom;
window.doToggleReady=doToggleReady; window.doAddBot=doAddBot; window.doRemoveBot=doRemoveBot;
window.doConfirmCard=doConfirmCard;
window.doEarlyVote=doEarlyVote; window.doVote=doVote;
window.doSpyGuess=doSpyGuess; window.doNextRound=doNextRound; window.doLeave=doLeave;
window.toggleChat=toggleChat; window.doSendChat=doSendChat;