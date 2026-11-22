import contextlib
import json
from pathlib import Path
import socket
import ssl
import sys
import time
import urllib.parse


def allowed(url):
    p = urllib.parse.urlsplit(url)
    host = p.hostname or ''
    return (p.scheme == 'https' and not p.username and not p.password
            and p.port in (None, 443) and (host == 'fb.watch' or host == 'facebook.com' or host.endswith('.facebook.com')))


class FetchFailure(Exception):
    pass


@contextlib.contextmanager
def fetching(stage):
    from requests import exceptions
    try:
        yield
    except exceptions.RequestException as err:
        pending = [err]
        seen = set()
        chain = []
        while pending:
            exc = pending.pop()
            if not isinstance(exc, BaseException) or id(exc) in seen:
                continue
            seen.add(id(exc))
            chain.append(exc)
            pending.extend((exc.__cause__, exc.__context__, getattr(exc, 'reason', None),
                            getattr(exc, 'original_error', None), *exc.args))
        reason = '网络请求失败'
        if any(isinstance(e, ConnectionResetError) for e in chain):
            reason = '网络连接被重置'
        elif any(isinstance(e, ConnectionRefusedError) for e in chain):
            reason = '连接被拒绝'
        elif any(isinstance(e, socket.gaierror) for e in chain):
            reason = '域名解析失败'
        elif any(isinstance(e, (exceptions.SSLError, ssl.SSLError)) for e in chain):
            reason = 'TLS 连接失败'
        elif any(isinstance(e, (TimeoutError, exceptions.Timeout)) for e in chain):
            reason = '网络请求超时'
        elif isinstance(err, exceptions.ProxyError):
            reason = '代理连接失败'
        if err.response is not None:
            reason = f'HTTP {err.response.status_code}'
        host = urllib.parse.urlsplit(getattr(err.request, 'url', '') or '').hostname
        dest = f'（{host}）' if host and (host == 'facebook.com' or host.endswith('.facebook.com')) else ''
        raise FetchFailure(f'{stage}失败：{reason}{dest}') from err


def login_cookies():
    from requests.cookies import RequestsCookieJar

    cookie_file = Path(__file__).resolve().parents[1] / 'backend/data/facebook_cookies.json'
    try:
        rows = json.loads(cookie_file.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        raise FetchFailure('无法读取本机 Facebook Cookie 文件，请检查文件及 JSON 格式') from None
    if not isinstance(rows, list):
        raise FetchFailure('本机 Cookie 文件须为 JSON 数组')
    jar = RequestsCookieJar()
    for row in rows:
        if not isinstance(row, dict):
            continue
        domain = row.get('domain')
        if not isinstance(domain, str) or not (domain.lstrip('.') == 'facebook.com' or domain.endswith('.facebook.com')):
            continue
        name, value = row.get('name'), row.get('value')
        if not isinstance(name, str) or not name or not isinstance(value, str) or not value:
            continue
        expiry = row.get('expirationDate', row.get('expires'))
        expires = int(expiry) if isinstance(expiry, (int, float)) and expiry > 0 else None
        if expires and expires <= time.time():
            continue
        jar.set(name, value, domain=domain, path=row.get('path') or '/', expires=expires, secure=True)
    if not {'c_user', 'xs'} <= set(jar.keys()):
        raise FetchFailure('本机 Cookie 文件缺少有效的 Facebook 登录会话')
    return jar


def read(url, report_title=None, authenticated=False):
    from bs4 import BeautifulSoup
    from requests import Session

    if not allowed(url):
        raise FetchFailure('请输入 Facebook 的 HTTPS 帖子链接')
    with Session() as session, fetching('连接 Facebook 帖子'):
        if authenticated:
            session.cookies.update(login_cookies())
        response = session.get(url, timeout=(8, 20), allow_redirects=False)
        for _ in range(5):
            if not response.is_redirect:
                break
            dest = urllib.parse.urljoin(response.url, response.headers['Location'])
            if not allowed(dest):
                raise FetchFailure('帖子跳转到 Facebook 以外的地址')
            response = session.get(dest, timeout=(8, 20), allow_redirects=False)
        if response.is_redirect:
            raise FetchFailure('帖子重定向次数过多')
        response.raise_for_status()
        if urllib.parse.urlsplit(response.url).path.startswith(('/login', '/checkpoint')):
            raise FetchFailure('帖子页面要求登录或验证')
        soup = BeautifulSoup(response.content, 'html.parser')

    caption = soup.select_one('[data-ad-preview="message"],[data-ad-comet-preview="message"]')
    title = caption.get_text(' ', strip=True) if caption else ''
    if not title:
        meta = soup.select_one('meta[property="og:title"]')
        title = (meta.get('content') or '').strip() if meta else ''
    if title and report_title:
        report_title(title[:160])
    rows = {}
    containers = soup.select('[role="article"],article,[data-sigil~="comment"]')
    def post_key(link):
        parsed = urllib.parse.urlsplit(link)
        args = urllib.parse.parse_qs(parsed.query)
        for key in ('fbid', 'story_fbid', 'v'):
            if args.get(key):
                return args[key][0]
        parts = parsed.path.strip('/').split('/')
        return next((parts[i+1] for i, part in enumerate(parts[:-1])
                     if part in ('posts', 'permalink', 'reel', 'videos')), None)
    target = post_key(response.url)
    def is_article(tag):
        return tag.name == 'article' or tag.get('role') == 'article' or 'comment' in (tag.get('data-sigil') or '').split()
    for container in containers:
        anchors = [a for a in container.select('a[href*="comment_id="]') if a.find_parent(is_article) is container]
        for anchor in anchors:
            link = urllib.parse.urlsplit(urllib.parse.urljoin(response.url, anchor['href']))
            if not allowed(link.geturl()):
                continue
            query = urllib.parse.parse_qs(link.query)
            if 'comment_id' not in query or not target or post_key(link.geturl()) != target:
                continue
            parent = query['comment_id'][0]
            cid = query.get('reply_comment_id', [parent])[0]
            body = [tag.get_text(' ', strip=True) for tag in container.select('div[dir="auto"],.commentBody')
                    if tag.find_parent(is_article) is container and not tag.select_one('div[dir="auto"],.commentBody')
                    and not tag.find_parent(['button','a']) and not tag.find_parent(attrs={'role': 'button'})]
            if cid and any(body):
                rows[cid] = {'id': cid, 'text': '\n'.join(body)[:8000]}
                if cid != parent:
                    rows[cid]['parentId'] = parent
                break
    if not rows:
        raise FetchFailure('页面 HTML 未提供可识别的评论正文，可能需要在浏览器中展开评论')
    return {'title': title[:160] or 'Facebook 帖子', 'comments': list(rows.values()),
            'notice': '已读取初始页面中的评论，折叠评论和回复需在浏览器展开'}


if __name__ == '__main__':
    try:
        with contextlib.redirect_stdout(sys.stderr):
            report = lambda title: print(json.dumps({'postTitle': title}), file=sys.__stdout__, flush=True)
            result = read(sys.argv[1], report if '--report-title' in sys.argv[2:] else None,
                          '--authenticated' in sys.argv[2:])
    except FetchFailure as err:
        result = {'error': str(err)}
    except ImportError as err:
        result = {'error': '本机网页解析依赖未就绪（' + str(err.name or 'import') + '）'}
    except Exception as err:
        result = {'error': '帖子页面解析失败（' + type(err).__name__ + '）'}
    print(json.dumps(result))
