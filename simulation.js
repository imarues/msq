// Classroom-only preset result entries, with a private audit record and channel allowlist.
export function parseDemoEntries(text,count){
  const lines=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(lines.length!==count)throw Error("أرسل "+count+" سطر بالضبط، سطر لكل فائز تجريبي.");
  const entries=[],seen=new Set();
  const handle=/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/;
  const handleFull=/^([^\r\n]{2,70}?)\s*[-–—|]\s*@([A-Za-z][A-Za-z0-9_]{4,31})$/u;
  const handleFirst=/^@([A-Za-z][A-Za-z0-9_]{4,31})\s*[-–—|]\s*(.{2,70})$/u;
  const idFull=/^([0-9]{4,20})\s*[-–—|]\s*(.{2,70})$/u;
  for(const line of lines){
    let entry;
    const a=handleFull.exec(line),b=handleFirst.exec(line),d=idFull.exec(line),h=handle.exec(line);
    if(a)entry={user_id:"demo:@"+a[2].toLowerCase(),name:a[1].trim(),username:a[2]};
    else if(b)entry={user_id:"demo:@"+b[1].toLowerCase(),name:b[2].trim(),username:b[1]};
    else if(d)entry={user_id:d[1],name:d[2].trim(),username:null};
    else if(h)entry={user_id:"demo:@"+h[1].toLowerCase(),name:"@"+h[1],username:h[1]};
    else throw Error("صيغة غير صحيحة: "+line.slice(0,70)+
      "\nاكتب «الاسم - @username» أو «123456789 - الاسم» أو «@username».");
    if(!entry.name||!entry.name.trim())throw Error("اسم الفائز التجريبي فارغ.");
    const k=entry.user_id.toLowerCase();
    if(seen.has(k))throw Error("لا تكرر نفس اليوزر أو الـID مرتين.");
    seen.add(k);entries.push(entry);
  }
  return entries;
}
export async function saveDemoEntries(env,id,entries){
  if(!Array.isArray(entries)||entries.length<1||entries.length>10)throw Error("عدد النتائج التجريبية غير صحيح.");
  await env.DB.prepare("INSERT INTO simulated_entries(contest_id,entries_json) VALUES(?,?)").bind(id,JSON.stringify(entries)).run();
}
export async function getDemoEntries(env,id){
  const row=await env.DB.prepare("SELECT entries_json FROM simulated_entries WHERE contest_id=?").bind(id).first();
  return row?JSON.parse(row.entries_json):null;
}


// Four authorized channels for posting the *educational demo*.
// Publication channels authorized by the project owner.
// Cloudflare's DEMO_ALLOWED_CHANNELS variable is not used.
const DEMO_PUBLICATION_CHANNELS = Object.freeze([
  "@zzxus81",
  "@iKiraPlus",
  "@iKiraPlus2",
  "@ikiraplus1",
]);
const canonical = value => String(value||"").trim().toLowerCase().replace(/^https?:\/\/(www\.)?t\.me\//,"@").replace(/^@/,"");
export function requireClassroomChannels(env,channels){
  // The allowlist restricts the *publication channel only*, not the subscription channels.
  const publishChannel=canonical(channels?.[0]?.username);
  const configured=DEMO_PUBLICATION_CHANNELS.filter(Boolean).map(canonical);
  if(configured.length>0 && (configured.length!==4 || new Set(configured).size!==4)){
    throw Error("قائمة قنوات العرض في الكود يجب أن تتضمن أربع قنوات مختلفة وصحيحة.");
  }
  // Once configured, only these explicitly approved publishing channels are allowed.
  const approved=configured;
  if(!publishChannel || !approved.includes(publishChannel)){
    throw Error("قناة نشر المسابقة غير مصرح بها لوضع العرض التجريبي. أضف يوزرها ضمن القنوات الأربع المسموحة في كود simulation.js.");
  }
}
