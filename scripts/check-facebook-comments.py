"""Check one public post with the Bright Data Facebook Comments scraper."""
import argparse
import getpass
import json
import os
import re
import sys
import time
from urllib import error, parse, request


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--snapshot", help="Resume an existing collection")
    args = parser.parse_args()
    host = parse.urlsplit(args.url)
    if host.scheme != "https" or host.hostname not in {"www.facebook.com", "facebook.com", "m.facebook.com", "fb.watch"}:
        parser.error("Expected a Facebook HTTPS URL")
    key = os.environ.get("BRIGHTDATA_API_KEY") or getpass.getpass("Bright Data API key: ")
    api = request.build_opener(NoRedirect())

    def call(path, data=None):
        req = request.Request("https://api.brightdata.com/datasets/v3/" + path,
                              data=json.dumps(data).encode() if data is not None else None,
                              headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            with api.open(req, timeout=35) as res:
                return json.load(res)
        except error.HTTPError as exc:
            detail = exc.read(1500).decode(errors="replace").replace(key, "[redacted]")
            sys.exit(f"Bright Data HTTP {exc.code}: {detail}")

    sid = args.snapshot or call("trigger?dataset_id=gd_lkay758p1eanlolqw8&format=json",
                                [{"url": args.url, "get_all_replies": False, "limit_records": 10}]).get("snapshot_id")
    if not re.fullmatch(r"s_[\w-]+", sid or ""):
        sys.exit("No valid snapshot ID returned")
    print("Snapshot:", sid, flush=True)
    for _ in range(36):
        progress = call("progress/" + sid)
        if progress.get("status") == "ready":
            break
        if progress.get("status") == "failed":
            sys.exit("Collection failed: " + str(progress.get("error", "see snapshot in Bright Data")))
        time.sleep(5)
    else:
        sys.exit("Still pending. Resume with --snapshot " + sid)
    rows = call("snapshot/" + sid + "?format=json")
    if not isinstance(rows, list):
        sys.exit("Unexpected snapshot format")
    usable = [row for row in rows if row.get("comment_id") or row.get("comment_text")]
    print("Comment records:", len(usable))
    for row in usable:
        print(json.dumps(str(row.get("comment_text") or "")[:400], ensure_ascii=True))
    for row in rows:
        if row.get("error") or row.get("warning"):
            print("Source:", ascii(str(row.get("error") or row.get("warning"))[:350]))


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, OSError, ValueError) as exc:
        sys.exit(str(exc))
