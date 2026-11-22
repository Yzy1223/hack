// Runs in Chrome's isolated content-script world. Only reads the rendered post.
async function readFacebookPost(requestedUrl) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const label = el => (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g,' ').trim();
  const buttons = root => [...root.querySelectorAll('[role="button"],button')].filter(el =>
    visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  const articleSelector = '[role="article"],article';
  function commentLinks(article) {
    return [...article.querySelectorAll('a[href*="comment_id="]')].filter(link => {
      if (link.closest(articleSelector) !== article) return false;
      const u = new URL(link.href);
      if (!['facebook.com','www.facebook.com','m.facebook.com'].includes(u.hostname)) return false;
      const target = identity(u.href);
      return target ? target === actual : !article.parentElement?.closest('[role="feed"]');
    });
  }
  const articles = root => [...root.querySelectorAll(articleSelector)].filter(a =>
    visible(a) && commentLinks(a).length);
  function identity(value) {
    const u = new URL(value);
    return u.searchParams.get('fbid') || u.searchParams.get('story_fbid') || u.searchParams.get('v')
      || u.pathname.match(/\/(?:reels?|posts|videos|permalink)\/([^/]+)/)?.[1];
  }
  const expected = identity(requestedUrl);
  const actual = identity(location.href);
  if (!actual || (expected && expected !== actual))
    return {error:'浏览器未进入指定帖子，可能需要登录或改用直接链接'};
  const isReel = /\/reels?\//.test(location.pathname);
  function panel() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible).reverse();
    const side = [...document.querySelectorAll('[role="complementary"],aside')].find(el => visible(el) &&
      (articles(el).length || buttons(el).some(b=>/评论|comments?/i.test(label(b)))));
    return dialogs.find(el => articles(el).length || buttons(el).some(b=>/评论|comments?/i.test(label(b))))
      || side || (!isReel && document.querySelector('main,[role="main"]'));
  }
  const hasComments = a => /(?:\d[\d,.]*\s*(?:条评论|comments?)|comments?\s*[,·:]\s*\d)/i.test(label(a));
  let scope;
  let opened=false;
  const initLimit=Date.now()+22000;
  while(Date.now()<initLimit) {
    scope=panel();
    if (scope && (articles(scope).length || buttons(scope).some(b=>/^(最相关|所有评论|Most relevant|All comments)$/i.test(label(b))) ||
        /暂无评论|还没有评论|No comments yet/i.test(scope.innerText))) break;
    if (!opened) {
      const main=document.querySelector('[role="main"],main');
      const open=buttons(scope || main || document).find(hasComments);
      if(open){open.click();opened=true;}
    }
    await sleep(450);
  }
  if(!scope) return {error:'浏览器中未找到此帖子的评论区'};
  const headline = () => {
    const message = [...scope.querySelectorAll('[data-ad-preview="message"],[data-ad-comet-preview="message"]')].find(visible);
    if(message?.innerText.trim()) return message.innerText.trim().split('\n')[0].slice(0,160);
    // Photo captions can be plain text nodes, without a message container.
    const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode(); node; node=walker.nextNode()){
      const p=node.parentElement, s=node.textContent.trim();
      if(!p || !visible(p) || s.length<8 ||
        p.closest('button,a,[role="button"],[role="article"][aria-label],[role="heading"],h1,h2,h3,[role="textbox"],script,style') ||
        /(?:\d{4}年|\d+周前|\d+条评论|分享对象|在线状态|身份验证|Most relevant|All comments)/i.test(s)) continue;
      return s.slice(0,160);
    }
    return (isReel?'Reel':'Facebook 帖子')+' · '+actual;
  };
  let title=headline();
  const sort=buttons(scope).find(b=>/^(最相关|由新到旧|Most relevant|Newest)$/i.test(label(b)));
  if(sort) {
    sort.click(); await sleep(450);
    const all=[...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"]')]
      .find(b=>visible(b)&&/^(所有评论|全部评论|All comments)/i.test(label(b)));
    if(all){all.click();await sleep(700);}else{sort.click();}
  }
  const rows=new Map();
  const more=/^(?:查看更多评论|查看更多回复|查看(?:另外)?\s*\d+\s*条回复|.{1,90}回复了\s*[·•]?\s*\d+\s*条回复|view (?:more|previous) comments|(?:view|see) (?:all |more )?\d+ repl(?:y|ies)|view more replies|.{1,90} replied\s*[·•]?\s*\d+ repl(?:y|ies))$/i;
  const tries=new WeakMap();
  const stop=Date.now()+125000;
  let idle=0, capped=false;
  while(Date.now()<stop && rows.size<1300 && idle<4) {
    if(identity(location.href)!==actual) return {error:'读取期间帖子地址已改变'};
    scope=panel();
    if(!scope) break;
    const before=rows.size;
    const elements=articles(scope);
    for(const el of elements) {
      const own=n=>n.closest('[role="article"],article')===el;
      const links=commentLinks(el);
      const author=[...el.querySelectorAll('a[href]')].find(a=>own(a) && a.innerText.trim() &&
        !a.closest('ul,[role="list"]') && !a.querySelector('time') &&
        (/\/profile\.php$/.test(new URL(a.href).pathname) || !a.href.includes('comment_id=') && a.querySelector('span[dir="auto"]')));
      const thread=links.map(a=>new URL(a.href)).find(url=>url.searchParams.has('reply_comment_id'));
      const u=thread || new URL(links[0].href);
      const id=u.searchParams.get('reply_comment_id') || u.searchParams.get('comment_id');
      if(!id || id.length>400) continue;
      const bodies=[...el.querySelectorAll('div[dir="auto"]')].filter(b=>
        own(b) && !b.querySelector('div[dir="auto"]') && !b.closest('[role="button"],button,[contenteditable="true"]') && !author?.contains(b));
      const text=bodies.map(b=>b.innerText.trim()).filter(Boolean).join('\n').slice(0,8000);
      const row={id,text,authorName:author?.innerText.trim().slice(0,256)};
      if(thread){
        const parent=thread.searchParams.get('comment_id');
        if(parent && parent!==id) {
          row.parentId=parent;
          try {
            const decoded=atob(id);
            if(/^comment:\d+_\d+$/.test(decoded) && /^\d+$/.test(parent)) row.parentId=btoa(decoded.replace(/_\d+$/,'_'+parent));
          } catch { /* Numeric comment IDs are also valid. */ }
        }
      }
      if(text || !rows.has(id)) rows.set(id,row);
    }
    const remaining=buttons(scope).filter(b=>more.test(label(b)));
    const next=remaining.find(b=>tries.get(b)?.count!==rows.size || tries.get(b).attempts<3);
    if(next) {
      const last=tries.get(next);
      tries.set(next,{count:rows.size,attempts:last?.count===rows.size ? last.attempts+1 : 1});
      next.scrollIntoView({block:'nearest'}); next.click(); idle=0;
    } else {
      elements.at(-1)?.scrollIntoView({block:'end'});
      idle=rows.size===before ? idle+1 : 0;
      if (idle===4 && remaining.length) capped=true;
    }
    await sleep(next ? 700 : 850);
  }
  capped=capped || !scope || Date.now()>=stop || rows.size>=1300;
  if(!rows.size && !(scope && /暂无评论|还没有评论|No comments yet/i.test(scope.innerText)))
    return {error:'评论区没有返回可核对的记录，请确认此浏览器能展开评论'};
  if(!title || title.endsWith(' · '+actual)) title=scope ? headline() : title;
  const comments=[];
  let bytes=0;
  for(const row of rows.values()){
    bytes+=new TextEncoder().encode(JSON.stringify(row)).length+1;
    if(bytes>2400000){capped=true;break;}
    comments.push(row);
  }
  return {title,comments,...(capped?{notice:'本轮只读取了部分评论，已保存可见记录'}:{})};
}
