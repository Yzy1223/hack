importScripts('read-post.js');

const backend = 'http://127.0.0.1:4310/api/browser-worker/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let running;

async function request(route, body) {
  const response = await fetch(backend + route, {
    method: 'POST', credentials: 'omit', redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: {'Content-Type':'application/json', 'X-Workbench-Request':'1'},
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('工作台请求失败 HTTP ' + response.status);
  return response.json();
}

function allowed(url) {
  const u = new URL(url);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['www.facebook.com','m.facebook.com','facebook.com','fb.watch'].includes(u.hostname);
}

async function collect(job) {
  if (!allowed(job.url)) return {error:'请添加 Facebook 帖子、照片或 Reel 的直接链接'};
  const tab = await chrome.tabs.create({url:job.url, active:false});
  await chrome.storage.session.set({workerTab:tab.id});
  try {
    const until = Date.now() + 30000;
    let loaded;
    while (Date.now() < until) {
      loaded = await chrome.tabs.get(tab.id);
      if (loaded.status === 'complete' && loaded.url && allowed(loaded.url)) break;
      await delay(400);
    }
    if (loaded?.status !== 'complete' || !loaded?.url || !allowed(loaded.url))
      return {error:'Chrome 未能打开目标帖子，请在此浏览器核对链接和登录状态'};
    const [frame] = await chrome.scripting.executeScript({
      target:{tabId:tab.id}, func:readFacebookPost, args:[job.url]
    });
    return frame?.result || {error:'帖子页面未返回可识别的评论数据'};
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
    await chrome.storage.session.remove('workerTab');
  }
}

async function poll() {
  // A service worker restart can leave a collector-owned tab behind.
  const {workerTab} = await chrome.storage.session.get('workerTab');
  if (workerTab !== undefined) {
    await chrome.tabs.remove(workerTab).catch(() => {});
    await chrome.storage.session.remove('workerTab');
  }
  for (let i=0; i<3; i++) {
    const {job} = await request('claim', {});
    if (!job) return;
    let result;
    try { result = await collect(job); }
    catch { result = {error:'Chrome 页面读取中断，请检查浏览器会话后重试'}; }
    await request('result', {id:job.id,token:job.token,result});
  }
}
function wake() {
  if (running) return running;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  running = poll().catch(() => {}).finally(() => {clearInterval(keepAlive); running=undefined;});
  return running;
}
async function start() {
  await chrome.alarms.create('monitor-posts', {periodInMinutes:0.5});
  await wake();
}
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'monitor-posts') void wake(); });
chrome.action.onClicked.addListener(wake);
