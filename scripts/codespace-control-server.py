#!/usr/bin/env python3
import json, os, pathlib, re, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
REPO=pathlib.Path('/workspaces/stock-info-mcp-gateway').resolve(); PORT=8765
CAP=(REPO/'.codespace-control/capability').read_text().strip(); MAX=120000
CHECKS=[['deno','check','supabase/functions/mcp/index.ts'],['deno','check','supabase/functions/mcp-v3/index.ts'],['deno','check','supabase/functions/mcp-options/index.ts'],['deno','check','supabase/functions/mcp-htsc/index.ts'],['deno','test','--allow-read=.']]
KNOWN={'qmt-mcp-client-half-file':'supabase/functions/mcp-v3/lib/qmt-mcp-client.ts','legacy-restore-script':'restore-codespace-control.sh'}
def run(a,stdin=None,timeout=300):
 p=subprocess.run(a,cwd=REPO,input=stdin,text=True,capture_output=True,timeout=timeout,env=os.environ.copy()); return {'argv':a,'rc':p.returncode,'stdout':p.stdout[:MAX],'stderr':p.stderr[:MAX]}
def status():
 s=run(['git','status','--short'])['stdout']; return {'ok':True,'service':'stock-info-mcp-gateway-fixed-control','repo':str(REPO),'branch':run(['git','branch','--show-current'])['stdout'].strip(),'head':run(['git','rev-parse','HEAD'])['stdout'].strip(),'dirty':bool(s.strip()),'status':s}
def release():
 out=[]
 for a in [['git','diff','--check'],*CHECKS]:
  r=run(a); out.append(r)
  if r['rc']!=0:return False,out
 scan=run(['git','grep','-nE',r'(github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{30,})']);out.append(scan);return scan['rc']!=0,out
def cleanup(name):
 if name not in KNOWN: raise ValueError('cleanup target not allowed')
 rel=KNOWN[name]; target=(REPO/rel).resolve()
 if os.path.commonpath([str(REPO),str(target)])!=str(REPO): raise ValueError('invalid cleanup path')
 if run(['git','ls-files','--error-unmatch',rel])['rc']==0: raise RuntimeError('refusing to remove tracked file')
 existed=target.exists()
 if existed and target.is_file(): target.unlink()
 return {'ok':True,'name':name,'path':rel,'existed':existed,'dirty_after':status()['dirty'],'status':status()['status']}
def apply_patch(patch):
 if not patch.strip(): raise ValueError('patch required')
 if status()['dirty']: raise RuntimeError('working tree is not clean; refusing to switch/update main')
 out=[]
 for a in [['git','fetch','origin','main'],['git','switch','main'],['git','pull','--ff-only','origin','main']]:
  r=run(a);out.append(r)
  if r['rc']!=0:return False,out
 for a in [['git','apply','--check','-'],['git','apply','--whitespace=nowarn','-']]:
  r=run(a,patch,120);out.append(r)
  if r['rc']!=0:return False,out
 r=run(['git','diff','--check']);out.append(r);return r['rc']==0,out
def commit_pr(b):
 branch=str(b.get('branch',''));msg=str(b.get('commit_message',''));title=str(b.get('title',''));body=str(b.get('body',''))
 if not re.fullmatch(r'automation/[A-Za-z0-9._/-]+',branch): raise ValueError('invalid automation branch')
 if not msg or not title: raise ValueError('commit_message and title required')
 if not status()['dirty']: raise RuntimeError('no pending changes')
 ok,checks=release()
 if not ok:return {'ok':False,'stage':'release','results':checks}
 out=[]
 for a in [['git','fetch','origin','main'],['git','switch','-c',branch],['git','add','-A'],['git','commit','-m',msg],['git','push','-u','origin',branch]]:
  r=run(a);out.append(r)
  if r['rc']!=0:return {'ok':False,'steps':out}
 q=run(['gh','pr','view',branch,'--json','url','-q','.url'])
 if q['rc']==0 and q['stdout'].strip():url=q['stdout'].strip()
 else:
  q=run(['gh','pr','create','--base','main','--head',branch,'--title',title,'--body',body]);out.append(q)
  if q['rc']!=0:return {'ok':False,'steps':out}
  url=q['stdout'].strip()
 return {'ok':True,'branch':branch,'pr':url,'steps':out}
class H(BaseHTTPRequestHandler):
 def log_message(self,*_):pass
 def sendj(self,x,c=200):
  b=json.dumps(x,ensure_ascii=False).encode();self.send_response(c);self.send_header('content-type','application/json');self.send_header('cache-control','no-store');self.end_headers();self.wfile.write(b)
 def suffix(self):
  p=f'/{CAP}';return self.path[len(p):] if self.path==p or self.path.startswith(p+'/') else None
 def do_GET(self):
  s=self.suffix();self.sendj(status()) if s in ('','/','/health','/status') else self.sendj({'error':'not found'},404)
 def do_POST(self):
  s=self.suffix()
  if s is None:return self.sendj({'error':'not found'},404)
  try:
   n=int(self.headers.get('content-length','0') or 0);b=json.loads(self.rfile.read(n) or b'{}')
   if s=='/release':
    ok,r=release();return self.sendj({'ok':ok,'results':r},200 if ok else 500)
   if s=='/apply-patch':
    ok,r=apply_patch(str(b.get('patch','')));return self.sendj({'ok':ok,'results':r},200 if ok else 500)
   if s=='/cleanup-known-artifact':return self.sendj(cleanup(str(b.get('name',''))))
   if s=='/commit-pr':
    r=commit_pr(b);return self.sendj(r,200 if r.get('ok') else 500)
   return self.sendj({'error':'not found'},404)
  except Exception as e:return self.sendj({'ok':False,'error':str(e)},500)
ThreadingHTTPServer(('127.0.0.1',PORT),H).serve_forever()
