import fetch from "node-fetch";

/*****************************************************************
 *                       Helper utilities                        *
 *****************************************************************/
function log(...a) { console.log(new Date().toISOString(), "|", ...a); }
function fatal(m)   { console.error("\n❌", m); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = arr => arr.map(v => [v, Math.random()])
                           .sort((a,b) => a[1]-b[1]).map(i => i[0]);
/*****************************************************************
 *                    Read + validate config                      *
 *****************************************************************/
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  FREECLOUD_ACCOUNTS,
  FREECLOUD_API_KEY,
  DELAY_SECONDS,
  DELAY_TYPE,
} = process.env;
if (!FREECLOUD_ACCOUNTS) fatal("缺少环境变量 FREECLOUD_ACCOUNTS");
if (!FREECLOUD_API_KEY) fatal("缺少环境变量 FREECLOUD_API_KEY");
let accounts; try { accounts = JSON.parse(FREECLOUD_ACCOUNTS); if (!Array.isArray(accounts)||!accounts.length) throw 0; } catch(e){ fatal("解析 FREECLOUD_ACCOUNTS 失败"); }
log(`📋 读取到 ${accounts.length} 个账号`);
/*****************************************************************
 *           Telegram helper – silent degrade if absent           *
 *****************************************************************/
async function pushTG(text){ if(!TELEGRAM_BOT_TOKEN||!TELEGRAM_CHAT_ID) return;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,parse_mode:"Markdown"})});
  const t = await res.text(); if(!res.ok) log("⚠️ TG 发送失败",t); }
/*****************************************************************
 *             Call Cloudflare Worker for each run               *
 *****************************************************************/
const WORKERS=[
  "https://freecloud.skylerhe.workers.dev",
];
async function invokeWorker(){
  for(const url of shuffle(WORKERS)){
    try{
      log("🔗 调用 Worker:",url);
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+FREECLOUD_API_KEY},body:JSON.stringify({accounts})});
      if(res.ok) return res.json();
      if(res.status===401) throw new Error("API Key 认证失败");
      log(`⚠️ Worker 返回 ${res.status}`);
    }catch(e){log("❌ Worker 调用异常",e.message);} }
  throw new Error("所有 Worker URL 都不可用"); }
/*****************************************************************
 *                Build markdown report for Telegram             *
 *****************************************************************/
function buildReport({processed,summary,results,key_usage}){
  let m=`🌤 *FreeCloud 多站点续期状态报告*\n\n`;
  m+=`📊 本次处理 ${processed} 账号，Key 本次 ${key_usage.this_operation} 次，总计 ${key_usage.total_used} 次\n`;
  m+=`✅ 登陆成功 ${summary.loginSuccess}  💰 续期成功 ${summary.renewSuccess}  ❌ 失败 ${summary.failed}\n\n`;
  m+=`📋 *详细结果:*\n`;
  results.forEach((a,i)=>{
    const tag=a.type||"freecloud";
    if(a.error){ m+=`❌ 账号${i+1} \`${a.username}\` (${tag}) 失败: ${a.error}\n`; return; }
    m+=`${a.loginSuccess?"✅":"❌"} 账号${i+1} \`${a.username}\` 登录${a.loginSuccess?"成功":"失败"}\n`;
    if(a.renewSuccess) m+=`💰 续期成功: ${a.message}\n`;
    else if(a.message) m+=`⚠️ 续期结果: ${a.message}\n`;
    m+="\n";
  });
  if(DELAY_SECONDS&&DELAY_TYPE){const s=+DELAY_SECONDS||0;m+=`⏱️ 本次${DELAY_TYPE}: ${s}s\n`;}
  m+=`⏰ ${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`;
  return m; }
/*****************************************************************
 *                           Main                                 *
 *****************************************************************/
(async()=>{ log("🚀 开始续期");
  try{ const res=await invokeWorker();
    log("✅ Worker 完成",res.summary);
    await pushTG(buildReport(res));
    if(res.summary.failed>0) process.exit(1);
    log("🎉 所有账号成功续期");
  }catch(e){ console.error("❌ 续期失败",e.message);
    await pushTG(`❌ *续期失败*\n${e.message}`); process.exit(1);} })();
