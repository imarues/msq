import { setupWinnerTables, addDrawConfig, contestMenu, announceAutomatic, retryUnannounced, adminWinnerCallback, manualWinnerMessage } from "./winners.js";
import { parseDemoEntries, saveDemoEntries, requireClassroomChannels } from "./simulation.js";
// Telegram contest bot for Cloudflare Workers / D1. No fake participants or winners.
// Only the configured Telegram owner can create competitions.
const DEFAULT_OWNER = "5036902759";
const timeNow = () => Math.floor(Date.now()/1000);
const s = v => String(v ?? "").trim();
const owner = env => s(env.OWNER_TELEGRAM_ID || DEFAULT_OWNER);
const admin = (env,u) => s(u?.id) === owner(env);
const inChat = m => ["creator","administrator","member"].includes(m?.status) || (m?.status==="restricted" && m.is_member===true);
const pad = v => String(v).padStart(2,"0");
const countdown = t => {let d=Math.max(0,Math.ceil(t));return pad(Math.floor(d/3600))+":"+pad(Math.floor(d%3600/60))+":"+pad(d%60);};
const baghdad = t => new Intl.DateTimeFormat("ar-IQ",{timeZone:"Asia/Baghdad",dateStyle:"medium",timeStyle:"short",hour12:false}).format(new Date(t*1000));
const toUser = v => {
  let x=s(v).replace(/^https?:\/\/(www\.)?t\.me\//i,"@").replace(/^t\.me\//i,"@").replace(/\/$/,"");
  if (!x.startsWith("@")) x="@"+x;
  return /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(x)?x:null;
};
function parseDuration(input) {
  let x=s(input).toLowerCase().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
  if (/^\d{1,4}:\d\d(?::\d\d)?$/.test(x)){const a=x.split(":").map(Number);return a.length===2?a[0]*3600+a[1]*60:a[0]*3600+a[1]*60+a[2];}
  if (/^\d+(?:\.\d+)?$/.test(x))return Number(x)*60;
  const units = {
    "ثانية":1,"ثانيه":1,"ثواني":1,"ثوان":1,"second":1,"seconds":1,"sec":1,"secs":1,"s":1,
    "دقيقة":60,"دقيقه":60,"دقائق":60,"دقايق":60,"دقيقتين":120,"minute":60,"minutes":60,"min":60,"mins":60,"m":60,
    "ساعة":3600,"ساعه":3600,"ساعات":3600,"ساعتين":7200,"hour":3600,"hours":3600,"hr":3600,"hrs":3600,"h":3600,
    "يوم":86400,"يومين":172800,"أيام":86400,"ايام":86400,"day":86400,"days":86400,"d":86400,
    "أسبوع":604800,"اسبوع":604800,"اسابيع":604800,"أسابيع":604800,"week":604800,"weeks":604800,"w":604800
  };
  x=x.replace(/\s+و\s*/g," ").replace(/(\d+)\s*(ساعات|ساعة|ساعه)\s*نص/g,"$1 ساعة 0.5 ساعة").replace(/^(ساعة|ساعه)\s*نص$/,"1 ساعة 0.5 ساعة");
  if (/^(يومين|ساعتين|دقيقتين)$/.test(x))x="1 "+x;
  x=x.replace(/(^|\s)(يومين|ساعتين|دقيقتين)(?=\s|$)/g,"$1 1 $2");
  if (/^(يوم|ساعة|ساعه|دقيقة|دقيقه)$/.test(x))x="1 "+x;
  const pattern=Object.keys(units).sort((a,b)=>b.length-a.length).join("|");
  const re=new RegExp("(\\d+(?:\\.\\d+)?)\\s*("+pattern+")(?![\\p{L}])","gu");
  let total=0,matched=0;
  for (const m of x.matchAll(re)){total+=Number(m[1])*units[m[2]];matched++;}
  return matched?Math.floor(total):0;
}
async function api(env, method, body){
  const r=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok || !data.ok)throw Error(method+": "+(data.description||r.status));
  return data.result;
}
const send=(env,chat,text,more={})=>api(env,"sendMessage",{chat_id:chat,text,disable_web_page_preview:true,...more});
const respond=(env,id,text="",alert=false)=>api(env,"answerCallbackQuery",{callback_query_id:id,text,show_alert:alert,cache_time:0});
const menu=()=>({reply_markup:{keyboard:[[{text:"🎉 مسابقة"}],[{text:"📚 مسابقاتي"},{text:"📊 الإحصائيات"}]],resize_keyboard:true}});
const cancelMenu=()=>({reply_markup:{inline_keyboard:[[{text:"❌ إلغاء",callback_data:"admin:cancel"}]]}});
async function init(env){
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS setup(owner_id TEXT PRIMARY KEY,step TEXT NOT NULL,data TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS contests(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,photo TEXT,chat_id TEXT NOT NULL,chat_username TEXT NOT NULL,post_id INTEGER,photo_post_id INTEGER,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,status TEXT NOT NULL,base_url TEXT NOT NULL,last_edit INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS channels(contest_id INTEGER NOT NULL,idx INTEGER NOT NULL,chat_id TEXT NOT NULL,username TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(contest_id,idx),UNIQUE(contest_id,chat_id))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS participants(contest_id INTEGER NOT NULL,user_id TEXT NOT NULL,name TEXT,username TEXT,bio TEXT,joined_at INTEGER NOT NULL,verified_at INTEGER NOT NULL,eligible INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(contest_id,user_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_contests_active ON contests(status,ends_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_participants ON participants(contest_id,eligible,verified_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS bot_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
  ]);
  await setupWinnerTables(env);
}
async function state(env){const r=await env.DB.prepare("SELECT * FROM setup WHERE owner_id=?").bind(owner(env)).first();return r?{step:r.step,data:JSON.parse(r.data)}:null;}
async function setState(env,step,data){await env.DB.prepare("INSERT INTO setup(owner_id,step,data) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET step=excluded.step,data=excluded.data").bind(owner(env),step,JSON.stringify(data)).run();}
async function clear(env){await env.DB.prepare("DELETE FROM setup WHERE owner_id=?").bind(owner(env)).run();}
async function channel(env,value,mustPost){
  const username=toUser(value);
  if(!username)throw Error("اكتب يوزر قناة عامة صحيح مثل @channelname");
  const [chat,me]=await Promise.all([api(env,"getChat",{chat_id:username}),api(env,"getMe",{})]);
  if(chat.type!=="channel")throw Error("اليوزر مو تابع لقناة.");
  const role=await api(env,"getChatMember",{chat_id:chat.id,user_id:me.id});
  if(!["creator","administrator"].includes(role.status))throw Error("البوت لازم يكون أدمن بالقناة.");
  if(mustPost&&role.status!=="creator"&&role.can_post_messages!==true)throw Error("فعّل صلاحية نشر الرسائل للبوت بقناة النشر.");
  const u="@"+(chat.username||username.substring(1));
  return {id:String(chat.id),username:u,title:chat.title||u,url:"https://t.me/"+u.substring(1)};
}
const htmlSafe = value => s(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function conditions(c){
  const channelList=[c.main,c.extra1,c.extra2]
    .map(ch=>"• <a href=\""+htmlSafe(ch.url)+"\">"+htmlSafe(ch.username)+"</a>").join("\n");
  const way=c.demo_winners?.length?"إعلان النتائج بعد انتهاء وقت المشاركة":
    c.announce_mode==="auto"?"قرعة عشوائية تلقائية عند انتهاء الوقت":
    "إعلان يدوي؛ مع توضيح طريقة اختيار الفائزين";
  return "📋 <b>شروط المسابقة:</b>\n<blockquote>"+
    "1. الانضمام للقنوات الثلاث:\n"+channelList+"\n"+
    "2. اضغط زر المشاركة حتى يتأكد البوت من عضويتك بالقنوات الثلاث.\n"+
    "3. المشاركة مرة واحدة لكل حساب، وتُلغى الأهلية إذا غادرت قناة.\n"+
    "4. آخر وقت للتسجيل: "+htmlSafe(baghdad(c.ends_at))+" (بتوقيت بغداد).\n"+
    "5. عدد الفائزين: "+(c.winner_count||1)+"، "+htmlSafe(way)+".</blockquote>"+
    "\n\n<em>ℹ️ الخصوصية: يسجل البوت الاسم واليوزر وID ووقت المشاركة ويرسلها للمسؤول؛ والبايو إذا كان متاحاً.</em>";
}
function fullText(c){return "🎉 "+htmlSafe(c.name)+"\n\n"+htmlSafe(c.description)+"\n\n"+conditions(c);}
async function getContest(env,id){return env.DB.prepare("SELECT * FROM contests WHERE id=?").bind(id).first();}
async function getChannels(env,id){const r=await env.DB.prepare("SELECT * FROM channels WHERE contest_id=? ORDER BY idx").bind(id).all();return r.results||[];}
async function count(env,id){const r=await env.DB.prepare("SELECT COUNT(*) AS n FROM participants WHERE contest_id=? AND eligible=1").bind(id).first();return Number(r?.n||0);}
function buttons(c,chs,n){
  const closed=c.status!=="active"||c.ends_at<=timeNow();
  const rows=[[{text:"👥 المشاركين: "+n,callback_data:"count:"+c.id}]];
  if(closed){rows.push([{text:"🔒 انتهت المشاركة",callback_data:"time:"+c.id}]);}
  else{
    // A channel post has one shared keyboard. Do not turn it green for
    // everybody when only one member has enrolled.
    rows.push([{text:"🔴 المشاركة بالمسابقة",callback_data:"join:"+c.id,style:"danger"}]);
    for(const ch of chs)rows.push([{text:"📢 "+(ch.idx===0?"قناة النشر":"قناة الاشتراك "+(ch.idx+1)),url:ch.url}]);
  }
  return {inline_keyboard:rows};
}
async function updateButtons(env,c,forced=false){
  if(!c?.post_id)return;
  if(!forced){
    const lock=await env.DB.prepare("UPDATE contests SET last_edit=? WHERE id=? AND last_edit<?").bind(timeNow(),c.id,timeNow()-8).run();
    if(!(lock.meta?.changes||0))return;
  }
  try{await api(env,"editMessageReplyMarkup",{chat_id:c.chat_id,message_id:c.post_id,reply_markup:buttons(c,await getChannels(env,c.id),await count(env,c.id))});}
  catch(e){if(!s(e.message).includes("message is not modified"))console.log("buttons: "+e.message);}
}
async function begin(env,chat){
  await setState(env,"main",{});
  await send(env,chat,"🎉 مسابقة جديدة\n\n1️⃣ أرسل يوزر القناة التي تريد نشر المسابقة بها.\nلازم البوت أدمن وعنده صلاحية نشر الرسائل.",cancelMenu());
}
async function preview(env,chat,st){
  const d=st.data;
  await setState(env,"ready",d);
  if(d.photo)await api(env,"sendPhoto",{chat_id:chat,photo:d.photo,caption:"🖼 معاينة صورة المسابقة"});
  await send(env,chat,"📝 معاينة المسابقة\n\n🏆 الاسم: "+d.name+"\n📢 النشر: "+d.main.username+"\n📢 اشتراك: "+d.extra1.username+"\n📢 اشتراك: "+d.extra2.username+"\n⏳ المدة: "+countdown(d.duration)+"\n🎖 عدد الفائزين: "+(d.winner_count||1)+"\n📢 إعلان النتائج: "+(d.announce_mode==="auto"?"تلقائي عند انتهاء الوقت":"يدوي من الإدارة")+"\n🧪 نوع العرض: "+(d.demo_winners?.length?"محاكاة تعليمية بأسماء محددة مسبقاً ("+d.demo_winners.length+")":"مسابقة عادية")+"\n\n"+d.description+"\n\nالشروط والخصوصية تضاف تلقائياً في آخر المنشور.\n\nلن يُنشر شيء قبل تأكيدك.",{reply_markup:{inline_keyboard:[[{text:"✅ تأكيد نشر المسابقة",callback_data:"admin:publish"}],[{text:"❌ إلغاء",callback_data:"admin:cancel"}]]}});
}
async function ownerMessage(env,msg){
  const id=msg.chat.id,x=s(msg.text||msg.caption),st=await state(env);
  if(x==="/start"||x==="القائمة")return send(env,id,"أهلاً بيك، إدارة المسابقات متاحة لحسابك فقط.",menu());
  if(x==="/cancel"||x==="إلغاء"){await clear(env);return send(env,id,"❎ ألغيت إعداد المسابقة.",menu());}
  if(x==="🎉 مسابقة"||x==="/contest")return begin(env,id);
  if(x==="📚 مسابقاتي"||x==="/contests")return listContests(env,id);
  if(x==="📊 الإحصائيات"||x==="/stats")return stats(env,id);
  if(/^\/participants(\s+\d+){1,2}$/.test(x)){const p=x.split(/\s+/);return listPeople(env,id,Number(p[1]),Math.max(1,Number(p[2]||1)));}
  if(st?.step==="winner_manual")return manualWinnerMessage(env,msg,st);
  if(!st)return send(env,id,"اضغط «🎉 مسابقة» حتى تبدأ.",menu());
  const d=st.data,step=st.step;
  try{
    if(step==="main"){
      d.main=await channel(env,x,true);
      await setState(env,"description",d);
      return send(env,id,"✅ القناة: "+d.main.username+"\n\n2️⃣ أرسل وصف المسابقة. تقبل رسالة نصية، صورة ويا وصف، أو صورة وبعدها رسالة وصف.",cancelMenu());
    }
    if(step==="description"||step==="photo_text"){
      const photo=msg.photo?.at(-1)?.file_id;
      if(photo)d.photo=photo;
      if(!x&&photo){await setState(env,"photo_text",d);return send(env,id,"✅ حفظت الصورة. هسه أرسل وصف المسابقة.",cancelMenu());}
      if(!x)return send(env,id,"أرسل وصف المسابقة كنص.",cancelMenu());
      if(x.length>2900)return send(env,id,"الوصف طويل. خلّه أقل من 2900 حرف حتى تكفي شروط المسابقة.",cancelMenu());
      d.description=x;
      await setState(env,"extra1",d);
      return send(env,id,"✅ حفظت الوصف.\n\n3️⃣ أرسل يوزر قناة الاشتراك الأولى (غير قناة النشر). البوت لازم يكون أدمن بيها.",cancelMenu());
    }
    if(step==="extra1"||step==="extra2"){
      const c=await channel(env,x,false);
      if(c.id===d.main.id||(d.extra1&&c.id===d.extra1.id))throw Error("لازم تختار ثلاث قنوات مختلفة.");
      if(step==="extra1"){d.extra1=c;await setState(env,"extra2",d);return send(env,id,"✅ القناة الثانية: "+c.username+"\n\n4️⃣ أرسل يوزر القناة الثالثة.",cancelMenu());}
      d.extra2=c;await setState(env,"duration",d);
      return send(env,id,"✅ تأكدت من القنوات الثلاث.\n\n5️⃣ اكتب مدة المسابقة بأي صيغة مثل:\n5 دقايق\n24 ساعة\nيومين و3 ساعات\n1h 30m\n01:30:00\n\nالحد من 10 ثواني إلى 90 يوم.",cancelMenu());
    }
    if(step==="duration"){
      const duration=parseDuration(x);
      if(!Number.isFinite(duration)||duration<10||duration>7776000)return send(env,id,"⚠️ مدة غير مفهومة. جرب «5 دقايق» أو «24 ساعة» أو «يومين و3 ساعات».",cancelMenu());
      d.duration=duration;await setState(env,"name",d);
      return send(env,id,"✅ المدة: "+countdown(duration)+"\n\n6️⃣ أرسل اسم المسابقة حتى أحفظها بقائمة مسابقاتك.",cancelMenu());
    }
    if(step==="name"){
      if(!x||x.length>90)return send(env,id,"اكتب اسم مختصر، بحد أقصى 90 حرف.",cancelMenu());
      d.name=x;await setState(env,"winner_count",d);return send(env,id,"🏆 شكد فائز تريد بالمسابقة؟ اكتب رقم من 1 إلى 10.",cancelMenu());
    }
    if(step==="winner_count"){
      const n=Number(x.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)));
      if(!Number.isSafeInteger(n)||n<1||n>10)return send(env,id,"اكتب عدد الفائزين من 1 إلى 10.",cancelMenu());
      d.winner_count=n;await setState(env,"winner_mode",d);
      return send(env,id,"📢 شلون تريد إعلان النتائج؟\n\nالتلقائي: عند انتهاء الوقت يعمل سحب عشوائي ويعلن الفائزين.\nاليدوي: عند انتهاء الوقت تنتظر حتى تضغط زر إعلان النتائج بنفسك.\n\nبالوضع اليدوي تگدر تسوي قرعة أو تختار فائزاً معلناً كاختيار يدوي.",{reply_markup:{inline_keyboard:[[{text:"🤖 تلقائي عند انتهاء المدة",callback_data:"admin:mode:auto"}],[{text:"👤 الإعلان بيدي",callback_data:"admin:mode:manual"}],[{text:"❌ إلغاء",callback_data:"admin:cancel"}]]}});
    }
    if(step==="winner_mode")return send(env,id,"اختار طريقة إعلان النتائج من الأزرار أعلاه.");
    if(step==="simulation_choice")return send(env,id,"اختار نعم أو لا من أزرار المحاكاة التعليمية.");
    if(step==="sim_entries"){
      const entries=parseDemoEntries(x,d.winner_count);
      d.demo_winners=entries;
      return preview(env,id,{data:d});
    }
    if(step==="ready"||step==="publishing")return send(env,id,"اضغط «تأكيد نشر المسابقة» أو «إلغاء» من أزرار المعاينة.");
  }catch(e){return send(env,id,"⚠️ "+e.message+"\n\nصحح المدخل وأعد إرساله.",cancelMenu());}
}
async function publish(env,cb,base){
  const st=await state(env);
  if(!st||st.step!=="ready")return respond(env,cb.id,"لا توجد معاينة جاهزة.",true);
  const locked=await env.DB.prepare("UPDATE setup SET step='publishing' WHERE owner_id=? AND step='ready'").bind(owner(env)).run();
  if(!locked.meta?.changes)return respond(env,cb.id,"جاري النشر حالياً.",true);
  await respond(env,cb.id,"جاري نشر المسابقة");
  const d=st.data;
  let contestId=null,posted=null;
  try{
    const [main,a,b]=await Promise.all([channel(env,d.main.username,true),channel(env,d.extra1.username,false),channel(env,d.extra2.username,false)]);
    if(new Set([main.id,a.id,b.id]).size!==3)throw Error("القنوات يجب أن تكون مختلفة.");
    if(d.demo_winners?.length)requireClassroomChannels(env,[main,a,b]);
    const start=timeNow(),end=start+d.duration;
    const ins=await env.DB.prepare("INSERT INTO contests(owner_id,name,description,photo,chat_id,chat_username,starts_at,ends_at,status,base_url) VALUES(?,?,?,?,?,?,?,?,'draft',?)")
      .bind(owner(env),d.name,d.description,d.photo||null,main.id,main.username,start,end,base).run();
    contestId=Number(ins.meta.last_row_id);
    const chs=[main,a,b];
    await env.DB.batch(chs.map((ch,idx)=>env.DB.prepare("INSERT INTO channels(contest_id,idx,chat_id,username,url) VALUES(?,?,?,?,?)").bind(contestId,idx,ch.id,ch.username,ch.url)));
    await addDrawConfig(env,contestId,d.winner_count,d.announce_mode);
    if(d.demo_winners?.length)await saveDemoEntries(env,contestId,d.demo_winners);
    const c={id:contestId,status:"active",ends_at:end,base_url:base};
    const body=fullText({...d,main,extra1:a,extra2:b,ends_at:end});
    const markup={reply_markup:buttons(c,chs.map((v,i)=>({...v,idx:i})),0)};
    let pictureId=null;
    if(d.photo&&body.length<=1024)posted=await api(env,"sendPhoto",{chat_id:main.id,photo:d.photo,caption:body,parse_mode:"HTML",...markup});
    else {
      if(d.photo){const p=await api(env,"sendPhoto",{chat_id:main.id,photo:d.photo,caption:"🎉 "+d.name});pictureId=p.message_id;}
      posted=await send(env,main.id,body,{...markup,parse_mode:"HTML"});
    }
    await env.DB.prepare("UPDATE contests SET status='active',post_id=?,photo_post_id=?,last_edit=? WHERE id=?").bind(posted.message_id,pictureId,timeNow(),contestId).run();
    await clear(env);
    return send(env,cb.from.id,"✅ تم نشر المسابقة!\n\n🏆 "+d.name+"\n🆔 رقم المسابقة: "+contestId+"\n⏳ النهاية: "+baghdad(end)+"\n🔗 https://t.me/"+main.username.slice(1)+"/"+posted.message_id+"\n\nلمراجعة المشاركين: /participants "+contestId,menu());
  }catch(e){
    if(contestId)await env.DB.prepare("UPDATE contests SET status='failed' WHERE id=? AND status='draft'").bind(contestId).run().catch(()=>{});
    await setState(env,"ready",d);
    return send(env,cb.from.id,"❌ فشل إكمال النشر: "+e.message+"\nإذا ظهر منشور بالقناة رغم الخطأ، لا تكرر النشر قبل مراجعته.");
  }
}
async function memberships(env,chs,uid){
  const checks=await Promise.all(chs.map(async ch=>{
    try{return inChat(await api(env,"getChatMember",{chat_id:ch.chat_id,user_id:Number(uid)}));}
    catch(e){console.log("member-check "+ch.chat_id+" "+e.message);return null;}
  }));
  return checks;
}
async function join(env,cb,c,ctx){
  if(c.status!=="active"||c.ends_at<=timeNow())return respond(env,cb.id,"🔒 انتهى الاشتراك.",true);
  const uid=s(cb.from.id),chs=await getChannels(env,c.id);
  const checks=await memberships(env,chs,uid);
  if(checks.includes(null))return respond(env,cb.id,"تعذر التأكد من إحدى القنوات. جرّب مرة أخرى.",true);
  if(checks.some(v=>!v)){
    await env.DB.prepare("UPDATE participants SET eligible=0,verified_at=? WHERE contest_id=? AND user_id=?").bind(timeNow(),c.id,uid).run();
    ctx.waitUntil(updateButtons(env,c));
    return respond(env,cb.id,"❌ لازم تنضم للقنوات الثلاث قبل الاشتراك.",true);
  }
  if(c.ends_at<=timeNow())return respond(env,cb.id,"🔒 انتهى الوقت.",true);
  const person=cb.from,full=[person.first_name,person.last_name].filter(Boolean).join(" ").slice(0,180);
  const previous=await env.DB.prepare("SELECT eligible FROM participants WHERE contest_id=? AND user_id=?").bind(c.id,uid).first();
  const moment=timeNow();
  const ins=await env.DB.prepare("INSERT OR IGNORE INTO participants(contest_id,user_id,name,username,bio,joined_at,verified_at,eligible) VALUES(?,?,?,?,NULL,?,?,1)")
    .bind(c.id,uid,full,person.username||null,moment,moment).run();
  const newMember=Boolean(ins.meta?.changes)||previous?.eligible===0;
  if(!ins.meta?.changes)await env.DB.prepare("UPDATE participants SET eligible=1,verified_at=?,name=?,username=? WHERE contest_id=? AND user_id=?").bind(moment,full,person.username||null,c.id,uid).run();
  await respond(env,cb.id,newMember?"✅ تم تسجيلك بنجاح!":"✅ أنت مسجل مسبقاً وعضويتك صحيحة.");
  ctx.waitUntil(updateButtons(env,c));
  if(newMember)ctx.waitUntil(send(env,uid,"✅ تم تسجيل مشاركتك في مسابقة «"+c.name+"» بنجاح.",{reply_markup:{inline_keyboard:[[{text:"🟢 أنت مشارك بالمسابقة",callback_data:"join:"+c.id,style:"success"}]]}}).catch(()=>{}));
  if(newMember)ctx.waitUntil((async()=>{
    let bio=null;try{const detail=await api(env,"getChat",{chat_id:Number(uid)});bio=detail.bio?.slice(0,350)||null;}catch{}
    if(bio)await env.DB.prepare("UPDATE participants SET bio=? WHERE contest_id=? AND user_id=?").bind(bio,c.id,uid).run();
    await send(env,owner(env),"👤 اشتراك جديد\n\n🏆 المسابقة: "+c.name+" (#"+c.id+")\n👤 الاسم: "+(full||"غير متاح")+"\n🔗 اليوزر: "+(person.username?"@"+person.username:"لا يوجد")+"\n🆔 ID: "+uid+"\n📝 البايو: "+(bio||"غير متاح")+"\n🕒 وقت الاشتراك: "+baghdad(moment)+" (بغداد)");
  })().catch(e=>console.log("notification: "+e.message)));
}
async function callbacks(env,cb,base,ctx){
  const code=s(cb.data);
  if(code.startsWith("admin:")){
    if(!admin(env,cb.from)||cb.message?.chat?.type!=="private")return respond(env,cb.id,"غير مصرح.",true);
    if(code==="admin:cancel"){await clear(env);await respond(env,cb.id,"تم الإلغاء.");return send(env,cb.from.id,"❎ تم إلغاء المسودة.",menu());}
    if(code==="admin:publish")return publish(env,cb,base);
    if(code.startsWith("admin:mode:")){
      const st=await state(env);if(st?.step!=="winner_mode")return respond(env,cb.id,"المسودة غير جاهزة.",true);
      const mode=code.slice("admin:mode:".length);if(!["auto","manual"].includes(mode))return respond(env,cb.id,"اختيار غير معروف.",true);
      await respond(env,cb.id,"تم اختيار طريقة الإعلان");
      st.data.announce_mode=mode;
      await setState(env,"simulation_choice",st.data);
      return send(env,cb.from.id,"🧪 خطوة أخيرة قبل النشر:\n\nهل تريد تفعيل «محاكاة تعليمية للنتائج»؟\n\nإذا نعم، تدخل أسماء أو معرفات للفائزين التجريبيين بدون فحص عضويتهم. وضع العرض يبقى واضح بسجل الإدارة وقابل للشرح للمشرفة، ويشتغل فقط بقنوات الاختبار الثلاث المحددة في Cloudflare.\nإذا لا، تبقى المسابقة عادية ويجري اختيار الفائزين المؤهلين بالشروط.",{reply_markup:{inline_keyboard:[[{text:"🧪 نعم، محاكاة تعليمية",callback_data:"admin:simulate:yes"}],[{text:"✅ لا، مسابقة عادية",callback_data:"admin:simulate:no"}],[{text:"❌ إلغاء",callback_data:"admin:cancel"}]]}});
    }
    if(code.startsWith("admin:simulate:")){
      const st=await state(env);if(st?.step!=="simulation_choice")return respond(env,cb.id,"الخطوة مو متاحة.",true);
      const choice=code.slice("admin:simulate:".length);
      if(!["yes","no"].includes(choice))return respond(env,cb.id,"خيار غير معروف.",true);
      await respond(env,cb.id,"تم اختيار نوع المسابقة");
      if(choice==="no"){delete st.data.demo_winners;return preview(env,cb.from.id,{data:st.data});}
      await setState(env,"sim_entries",st.data);
      return send(env,cb.from.id,"🧪 أرسل قائمة النتائج التجريبية، سطر لكل اسم، وعددها "+st.data.winner_count+".\n\nالصيغة المفضلة حتى يظهر الاسم بجانب اليوزر:\nAli Hussain - @hx5x5i\n\nإذا بدون يوزر:\n123456789 - Nadeen\n\nوتكدر ترسل @username وحده، لكن اسم صاحبه يظهر فقط إذا يگدر البوت يحصل عليه من معلومات تليكرام أو المشتركين؛ وإلا يعرض اليوزر وحده.\n\nالنتائج المحددة مسبقاً محفوظة للعرض الدراسي وتظهر حقيقتها بتقرير الإدارة الخاص.",cancelMenu());
    }
    if(await adminWinnerCallback(env,cb))return;
    return respond(env,cb.id,"زر غير معروف.");
  }
  const m=/^(join|count|time):(\d+)$/.exec(code);
  if(!m)return respond(env,cb.id,"زر غير معروف.");
  const c=await getContest(env,Number(m[2]));
  if(!c||!["active","ended"].includes(c.status))return respond(env,cb.id,"المسابقة غير متاحة.",true);
  if(m[1]==="join")return join(env,cb,c,ctx);
  if(m[1]==="count")return respond(env,cb.id,"👥 المشاركين المؤهلين: "+(await count(env,c.id)));
  return respond(env,cb.id,c.ends_at<=timeNow()?"🔒 انتهت المشاركة.":"⏳ المتبقي: "+countdown(c.ends_at-timeNow()),true);
}
async function listContests(env,chat){
  const r=await env.DB.prepare("SELECT id,name,status,ends_at FROM contests ORDER BY id DESC LIMIT 20").all();
  if(!r.results?.length)return send(env,chat,"ماكو مسابقات منشورة بعد.",menu());
  return send(env,chat,"📚 مسابقاتي\n\n"+r.results.map(c=>"#"+c.id+" "+c.name+" — "+(c.status==="active"&&c.ends_at>timeNow()?"🟢 فعالة":"🔒 منتهية")+"\n"+baghdad(c.ends_at)).join("\n\n")+"\n\nاضغط المسابقة لإدارة الفائزين.",{reply_markup:{inline_keyboard:r.results.slice(0,12).map(v=>[{text:"🏆 "+v.name.slice(0,45)+" #"+v.id,callback_data:"admin:contest:"+v.id}])}});
}
async function stats(env,chat){
  const r=await env.DB.prepare("SELECT id,name,ends_at FROM contests WHERE status IN ('active','ended') ORDER BY id DESC LIMIT 10").all();
  if(!r.results?.length)return send(env,chat,"ماكو مسابقات منشورة بعد.",menu());
  const arr=[];for(const c of r.results)arr.push("🏆 "+c.name+" (#"+c.id+")\n👥 "+(await count(env,c.id))+" مشترك\n"+(c.ends_at>timeNow()?countdown(c.ends_at-timeNow()):"انتهت"));
  return send(env,chat,"📊 الإحصائيات\n\n"+arr.join("\n\n"),menu());
}
async function listPeople(env,chat,id,page){
  const c=await getContest(env,id);if(!c)return send(env,chat,"المسابقة غير موجودة.");
  const r=await env.DB.prepare("SELECT * FROM participants WHERE contest_id=? ORDER BY joined_at DESC LIMIT 12 OFFSET ?").bind(id,(Math.min(page,999)-1)*12).all();
  if(!r.results?.length)return send(env,chat,"ماكو مشتركين بهاي الصفحة.");
  const out=r.results.map((p,i)=>(i+1)+". "+(p.name||"غير متاح")+(p.eligible?" ✅":" ❌")+"\n"+(p.username?"@"+p.username:"بدون يوزر")+" | "+p.user_id+"\n📝 "+(p.bio||"بايو غير متاح")+"\n🕒 "+baghdad(p.joined_at));
  return send(env,chat,("👥 المشاركين في "+c.name+" — الصفحة "+page+"\n\n"+out.join("\n\n")).slice(0,3900));
}
async function memberEvent(env,event,ctx){
  const chatId=s(event.chat?.id),userId=s(event.new_chat_member?.user?.id);
  if(!chatId||!userId||inChat(event.new_chat_member))return;
  const r=await env.DB.prepare("SELECT c.id FROM contests c INNER JOIN channels h ON h.contest_id=c.id WHERE c.status='active' AND c.ends_at>? AND h.chat_id=?").bind(timeNow(),chatId).all();
  for(const entry of r.results||[]){
    const v=await env.DB.prepare("UPDATE participants SET eligible=0,verified_at=? WHERE contest_id=? AND user_id=? AND eligible=1").bind(timeNow(),entry.id,userId).run();
    if(v.meta?.changes)ctx.waitUntil(updateButtons(env,await getContest(env,entry.id)));
  }
}
async function ensureWebhook(env){
  if(!env.BOT_TOKEN || !env.WEBHOOK_SECRET)throw Error("Missing Telegram credentials.");
  const target="https://msq.ikiraplus.workers.dev/webhook";
  const bytes=new TextEncoder().encode(env.BOT_TOKEN+"\n"+env.WEBHOOK_SECRET+"\n"+target);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(v=>v.toString(16).padStart(2,"0")).join("");
  const stored=await env.DB.prepare("SELECT value FROM bot_settings WHERE key='webhook_hash'").first();
  if(stored?.value===hash)return;
  await api(env,"setWebhook",{
    url:target,
    secret_token:env.WEBHOOK_SECRET,
    allowed_updates:["message","callback_query","chat_member"],
    drop_pending_updates:false
  });
  await env.DB.prepare("INSERT INTO bot_settings(key,value) VALUES('webhook_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(hash).run();
  console.log("Telegram webhook configured.");
}
async function scheduled(env){
  const r=await env.DB.prepare("SELECT * FROM contests WHERE status='active' ORDER BY id DESC LIMIT 50").all();
  for(const c of r.results||[])try{
    if(timeNow()>=c.ends_at){
      const v=await env.DB.prepare("UPDATE contests SET status='ended' WHERE id=? AND status='active'").bind(c.id).run();
      await updateButtons(env,{...c,status:"ended"},true);
      if(v.meta?.changes)await send(env,c.owner_id,"🔒 انتهت المشاركة بالمسابقة: "+c.name+" (#"+c.id+")\n👥 المشاركين المؤهلين: "+(await count(env,c.id))+"\nافتح «مسابقاتي» لإدارة النتائج.");
      try{await announceAutomatic(env,{...c,status:"ended"});}catch(e){console.log("auto draw #"+c.id+": "+e.message);}
    }else{
      const chs=await getChannels(env,c.id);
      const p=await env.DB.prepare("SELECT user_id FROM participants WHERE contest_id=? AND eligible=1 ORDER BY verified_at ASC LIMIT 5").bind(c.id).all();
      for(const user of p.results||[]){
        const checks=await memberships(env,chs,user.user_id);
        if(!checks.includes(null))await env.DB.prepare("UPDATE participants SET eligible=?,verified_at=? WHERE contest_id=? AND user_id=?").bind(checks.every(Boolean)?1:0,timeNow(),c.id,user.user_id).run();
      }
      await updateButtons(env,c,true);
    }
  }catch(e){console.log("cron "+c.id+" "+e.message);}
  await retryUnannounced(env);
}
function page(c){
  const end=Number(c.ends_at)*1000,id=Number(c.id);
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>عداد المسابقة</title><style>body{font-family:system-ui;background:#141a29;color:white;margin:0;min-height:100vh;display:grid;place-items:center}main{padding:28px;background:#232c3f;border-radius:18px;text-align:center}#t{font-size:46px;font-weight:700;direction:ltr}</style></head><body><main><h2>⏳ الوقت المتبقي</h2><div id="t">--:--:--</div><p id="n"></p></main><script>const end='+end+',id='+id+';const p=x=>String(x).padStart(2,"0");function tick(){let n=Math.max(0,Math.ceil((end-Date.now())/1000));document.querySelector("#t").textContent=p(Math.floor(n/3600))+":"+p(Math.floor(n%3600/60))+":"+p(n%60);if(!n)document.querySelector("h2").textContent="انتهت المشاركة"}async function tally(){try{let r=await fetch("/count?id="+id);let j=await r.json();document.querySelector("#n").textContent="المشتركون: "+j.count}catch{}}tick();tally();setInterval(tick,1000);setInterval(tally,15000)</script></body></html>';
}
export default {
  async fetch(req,env,ctx){
    const url=new URL(req.url);
    if(req.method==="GET"&&url.pathname==="/health"){
      if(!env.DB||!env.BOT_TOKEN||!env.WEBHOOK_SECRET)return new Response("Missing configuration",{status:503});
      try{await init(env);await ensureWebhook(env);return new Response("OK - Telegram webhook configured",{headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});}
      catch(e){console.log("Telegram setup error: "+e.message);return new Response("Telegram webhook setup failed. Check Workers logs.",{status:503});}
    }
    if(req.method==="GET"&&["/timer","/count"].includes(url.pathname)){
      const id=Number(url.searchParams.get("id"));
      if(!Number.isSafeInteger(id)||id<1||!env.DB)return new Response("Not found",{status:404});
      await init(env);const c=await getContest(env,id);
      if(!c||!["active","ended"].includes(c.status))return new Response("Not found",{status:404});
      if(url.pathname==="/timer")return new Response(page(c),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
      return Response.json({count:await count(env,id)},{headers:{"cache-control":"no-store"}});
    }
    if(req.method!=="POST"||url.pathname!=="/webhook")return new Response("Not found",{status:404});
    if(!env.DB||!env.BOT_TOKEN||!env.WEBHOOK_SECRET)return new Response("Not configured",{status:503});
    if(req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==env.WEBHOOK_SECRET)return new Response("Forbidden",{status:403});
    try{
      await init(env);
      const update=await req.json();
      if(update.callback_query)await callbacks(env,update.callback_query,url.origin,ctx);
      else if(update.chat_member)await memberEvent(env,update.chat_member,ctx);
      else if(update.message?.chat?.type==="private"&&admin(env,update.message.from))await ownerMessage(env,update.message);
      return new Response("OK");
    }catch(e){console.log("webhook error "+e.stack);return new Response("Error",{status:500});}
  },
  async scheduled(_,env,ctx){if(env.DB&&env.BOT_TOKEN){await init(env);ctx.waitUntil((async()=>{try{await ensureWebhook(env);}catch(e){console.log("Webhook auto-registration failed: "+e.message);}await scheduled(env);})());}}
};
