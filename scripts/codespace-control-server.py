#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser=argparse.ArgumentParser()
parser.add_argument("--repo", required=True)
parser.add_argument("--state-dir", required=True)
parser.add_argument("--port", type=int, default=8765)
args=parser.parse_args()

REPO=pathlib.Path(args.repo).resolve()
STATE_DIR=pathlib.Path(args.state_dir).resolve()
PORT=args.port
CAP=(STATE_DIR/"capability").read_text().strip()
MAX_OUTPUT=120000

CHECKS=[
    ["deno","check","supabase/functions/mcp/index.ts"],
    ["deno","check","supabase/functions/mcp-v3/index.ts"],
    ["deno","check","supabase/functions/mcp-options/index.ts"],
    ["deno","check","supabase/functions/mcp-htsc/index.ts"],
    ["deno","test","--allow-read=.","supabase/functions/mcp-v3/lib","supabase/functions/mcp-options/lib","supabase/functions/mcp-htsc","tests"],
]
KNOWN_CLEANUP={
    "qmt-mcp-client-half-file":"supabase/functions/mcp-v3/lib/qmt-mcp-client.ts",
    "manual-recovery-script":"restore-codespace-control.sh",
}

def clip(v):
    s=str(v or "")
    return s if len(s)<=MAX_OUTPUT else s[:MAX_OUTPUT]+"\n...[truncated]"

def run(argv, stdin=None, timeout=300):
    p=subprocess.run(argv,cwd=REPO,input=stdin,text=True,capture_output=True,timeout=timeout,env=os.environ.copy())
    return {"argv":argv,"rc":p.returncode,"stdout":clip(p.stdout),"stderr":clip(p.stderr)}

def status_text():
    return run(["git","status","--short"])["stdout"]

def health():
    return {
        "ok":True,
        "service":"stock-info-mcp-gateway-fixed-control",
        "repo":str(REPO),
        "branch":run(["git","branch","--show-current"])["stdout"].strip(),
        "head":run(["git","rev-parse","HEAD"])["stdout"].strip(),
        "dirty":bool(status_text().strip()),
        "status":status_text(),
    }

def release():
    results=[]
    r=run(["git","diff","--check"]); results.append(r)
    if r["rc"]!=0: return False,results
    for cmd in CHECKS:
        r=run(cmd); results.append(r)
        if r["rc"]!=0: return False,results
    scan=run(["git","grep","-nE",r"(github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{30,})"])
    results.append({**scan,"credential_scan_match":scan["rc"]==0})
    if scan["rc"]==0: return False,results
    return True,results

def apply_patch(patch):
    if not patch.strip(): raise ValueError("patch required")
    if status_text().strip(): raise RuntimeError("working tree is not clean; refusing to switch/update main")
    steps=[]
    for cmd in [["git","fetch","origin","main"],["git","switch","main"],["git","pull","--ff-only","origin","main"]]:
        r=run(cmd); steps.append(r)
        if r["rc"]!=0:return False,steps
    for cmd in [["git","apply","--check","-"],["git","apply","--whitespace=nowarn","-"]]:
        r=run(cmd,stdin=patch,timeout=120); steps.append(r)
        if r["rc"]!=0:return False,steps
    r=run(["git","diff","--check"]); steps.append(r)
    return r["rc"]==0,steps

def cleanup_known(name):
    rel=KNOWN_CLEANUP.get(name)
    if not rel: raise ValueError("cleanup target not allowed")
    target=(REPO/rel).resolve()
    if os.path.commonpath([str(REPO),str(target)])!=str(REPO): raise ValueError("invalid cleanup path")
    tracked=run(["git","ls-files","--error-unmatch",rel])
    if tracked["rc"]==0: raise RuntimeError("refusing to remove tracked file")
    existed=target.exists()
    if existed: target.unlink()
    return {"ok":True,"name":name,"path":rel,"existed":existed,"dirty_after":bool(status_text().strip()),"status":status_text()}

def commit_pr(body):
    branch=str(body.get("branch","")).strip()
    message=str(body.get("commit_message","")).strip()
    title=str(body.get("title","")).strip()
    pr_body=str(body.get("body","")).strip()
    if not re.fullmatch(r"automation/[A-Za-z0-9._/-]+",branch): raise ValueError("invalid automation branch")
    if not message or not title: raise ValueError("commit_message and title required")
    if not status_text().strip(): raise RuntimeError("no pending changes")
    ok,rr=release()
    if not ok:return {"ok":False,"stage":"release","results":rr}
    steps=[]
    for cmd in [["git","fetch","origin","main"],["git","switch","-c",branch],["git","add","-A"],["git","commit","-m",message],["git","push","-u","origin",branch]]:
        r=run(cmd);steps.append(r)
        if r["rc"]!=0:return {"ok":False,"steps":steps}
    r=run(["gh","pr","create","--base","main","--head",branch,"--title",title,"--body",pr_body])
    steps.append(r)
    return {"ok":r["rc"]==0,"branch":branch,"pr":r["stdout"].strip(),"steps":steps}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): pass
    def send_json(self,obj,status=200):
        raw=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type","application/json; charset=utf-8")
        self.send_header("cache-control","no-store")
        self.end_headers()
        self.wfile.write(raw)
    def suffix(self):
        prefix=f"/{CAP}"
        if self.path==prefix:return "/"
        if self.path.startswith(prefix+"/"):return self.path[len(prefix):]
        return None
    def do_GET(self):
        s=self.suffix()
        if s is None:return self.send_json({"error":"not found"},404)
        try:
            if s in ("/","/health","/status"):return self.send_json(health())
            return self.send_json({"error":"not found"},404)
        except Exception as e:return self.send_json({"ok":False,"error":str(e)},500)
    def do_POST(self):
        s=self.suffix()
        if s is None:return self.send_json({"error":"not found"},404)
        try:
            n=int(self.headers.get("content-length","0") or 0)
            body=json.loads(self.rfile.read(n) or b"{}")
            if s=="/release":
                ok,res=release();return self.send_json({"ok":ok,"results":res},200 if ok else 500)
            if s=="/apply-patch":
                ok,res=apply_patch(str(body.get("patch","")));return self.send_json({"ok":ok,"results":res},200 if ok else 500)
            if s=="/cleanup-known-artifact":
                return self.send_json(cleanup_known(str(body.get("name",""))))
            if s=="/commit-pr":
                out=commit_pr(body);return self.send_json(out,200 if out.get("ok") else 500)
            return self.send_json({"error":"not found"},404)
        except Exception as e:return self.send_json({"ok":False,"error":str(e)},500)

ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()
