/* QA V33.1.0 navigation/status patch (2026-09-24).
   QA V33 adapter. No Apps Script runtime is required.
   Original callback-shaped calls are preserved as QA.run; the implementation is Supabase.
   Mutation permissions and transitions are enforced in SQL, not by these UI checks. */
(() => {
  'use strict';
  const cfg = window.QA_CONFIG || {};
  const QA = window.QA = {profile: null, client: null, version: '33.1.0'};
  const versions = new Map();
  let busy = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve,reject) => {readyResolve=resolve;readyReject=reject;});
  ready.catch(() => {});
  // Resolve links from this script's folder, never from the domain root.
  // This works both at / and at /repository-name/ on GitHub Pages.
  const appBase = new URL('.', document.currentScript?.src || location.href);
  const pageFiles = Object.freeze({create:'index.html', index:'index.html',
    job:'job.html', history:'history.html', dashboard:'dashboard.html', login:'login.html'});
  const pageName = input => {
    try {
      const u = new URL(input || location.href, appBase);
      if(u.origin!==appBase.origin || !u.pathname.startsWith(appBase.pathname)) return '';
      const tail=u.pathname.slice(appBase.pathname.length);
      if(!tail || tail==='index.html' || tail==='index') return 'create';
      return Object.keys(pageFiles).find(k => tail===pageFiles[k] || tail===k) || '';
    } catch {return '';}
  };
  QA.pageName = pageName;
  QA.pageUrl = (page, params={}) => {
    if(!Object.prototype.hasOwnProperty.call(pageFiles,page)) throw new Error('Unknown application page');
    const u=new URL(pageFiles[page],appBase);
    for(const [key,value] of Object.entries(params)) {
      if(value!==null && value!==undefined && String(value)!=='') u.searchParams.set(key,String(value));
    }
    return u.href;
  };
  const validJobId = value => {
    const id=String(value ?? '').trim();
    return id && id.length<=100 && !/[\u0000-\u001f\u007f]/.test(id) &&
      !['undefined','null','[object Object]'].includes(id) ? id : '';
  };
  QA.jobIdFromUrl = (input=location.href) => {
    try {
      const params=new URL(input,appBase).searchParams;
      // job is the canonical parameter; retain compatibility with old links.
      return validJobId(params.get('job') || params.get('jobId') || params.get('job_id'));
    } catch {return '';}
  };
  QA.jobUrl = jobId => {
    const id=validJobId(jobId);
    if(!id) throw new Error('Missing Job ID. Open a job from Job History.');
    return QA.pageUrl('job',{job:id});
  };
  const currentJobKey = () => QA.profile?.user_id
    ? `qa-current-job:${appBase.href}:${cfg.supabaseUrl}:${QA.profile.user_id}` : '';
  QA.lastJobId = () => {
    try {const key=currentJobKey();return key ? validJobId(sessionStorage.getItem(key)) : '';}
    catch {return '';}
  };
  QA.rememberJob = jobId => {
    const id=validJobId(jobId),key=currentJobKey();
    if(!id || !key) return;
    try {sessionStorage.setItem(key,id);} catch { /* Navigation still works without storage. */ }
    window.refreshQaCurrentJobLink?.(id);
  };
  QA.forgetJob = jobId => {
    if(jobId && QA.lastJobId()!==String(jobId)) return;
    try {const key=currentJobKey();if(key) sessionStorage.removeItem(key);} catch {}
    window.refreshQaCurrentJobLink?.('');
  };
  QA.openJob = (jobId, options={}) => {
    const url=QA.jobUrl(jobId);
    // Call only after a confirmed save or a successful read. This stores an ID,
    // not a job snapshot; Supabase continues to enforce permissions on every read.
    QA.rememberJob(jobId);
    if(options.replace) location.replace(url);else location.assign(url);
  };
  const statusLabels=Object.freeze({
    OPEN:'เปิดงาน / รอรับงาน',
    IN_PROGRESS:'กำลังดำเนินการ',
    WAITING_QA:'รอ QA ตรวจสอบ',
    REWORK:'ส่งกลับแก้ไข',
    CLOSED:'ปิดงานแล้ว'
  });
  QA.statusInfo = value => {
    const code=String(value || '').trim().toUpperCase();
    const known=Object.prototype.hasOwnProperty.call(statusLabels,code);
    return {code:code || 'UNKNOWN',cssClass:known?code:'UNKNOWN',
      label:known?statusLabels[code]:'ไม่ทราบสถานะ'};
  };
  QA.setStatusBadge = (el,value) => {
    const info=QA.statusInfo(value);
    el.className='status '+info.cssClass;
    el.textContent=info.label+' ('+info.code.replace(/_/g, ' ')+')';
    el.dataset.status=info.code;
    el.setAttribute('aria-label','สถานะ: '+el.textContent);
    el.title=el.textContent;
  };
  const isLogin = pageName()==='login';
  const messageMap = {
    AUTH_REQUIRED: 'กรุณาเข้าสู่ระบบ',
    PROFILE_NOT_ACTIVE: 'บัญชีนี้ยังไม่มีสิทธิ์ (qa_profiles)',
    STALE_VERSION_REFRESH_REQUIRED: 'มีผู้แก้ไขใบงานแล้ว กรุณาโหลดใหม่ก่อนบันทึก',
    QA_ROLE_REQUIRED: 'Only QA or admin can create/verify jobs.',
    ASSIGNED_DEPARTMENT_ROLE_REQUIRED: 'Only the assigned department or admin can accept/edit this job.',
    JOB_NOT_FOUND_OR_FORBIDDEN: 'Job not found, or your account cannot access it.',
    INVALID_OR_INACTIVE_SETTINGS: 'Select active department, category and priority values from Settings.',
    UNRESOLVED_REQUEST: 'A previous save has an unknown outcome. Click Recover pending save before making another change.'
  };
  function errorOf(e) {
    const msg = String(e?.message || e || 'Unknown error');
    const key = Object.keys(messageMap).find(k => msg.includes(k));
    const out = new Error(key ? messageMap[key] + ' [' + key + ']' : msg);
    out.code = e?.code; return out;
  }
  QA.errorOf = errorOf;
  QA.escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  QA.notify = message => {
    let el=document.getElementById('qa-system-note');
    if(!el){el=document.createElement('div');el.id='qa-system-note';el.setAttribute('role','alert');
      el.style.cssText='background:#fff4ce;color:#402a00;padding:12px;margin:12px;border:1px solid #ccb66d;white-space:pre-wrap;';
      (document.querySelector('.qa-app-content')||document.body).prepend(el);}
    el.textContent=String(message);
  };
  function fatal(e) {
    document.body.classList.remove('qa-auth-loading');
    QA.notify(errorOf(e).message);
    document.querySelectorAll('form input,form select,form textarea,form button').forEach(el=>el.disabled=true);
    if(QA.client){const out=document.createElement('button');out.type='button';out.textContent='Sign out / Login';out.onclick=()=>QA.signOut();document.getElementById('qa-system-note').append(out);}
  }
  function safeNext(raw, defaultPage='create') {
    const fallback=QA.pageUrl(defaultPage);
    try {
      if(!raw) return fallback;
      const u=new URL(raw,appBase),page=pageName(u.href);
      if(u.username || u.password || !['create','job','history','dashboard'].includes(page)) return fallback;
      const id=QA.jobIdFromUrl(u.href);
      if(page==='job' || (page==='create' && id)) return id?QA.jobUrl(id):QA.pageUrl('history');
      return QA.pageUrl(page,Object.fromEntries(u.searchParams));
    } catch {return fallback;}
  }
  QA.safeNext=safeNext;
  QA.loginUrl=() => {
    const page=pageName(),id=QA.jobIdFromUrl();
    let next;
    if(id && ['create','job'].includes(page)) next=QA.jobUrl(id);
    else if(['create','history','dashboard'].includes(page)) next=QA.pageUrl(page,Object.fromEntries(new URLSearchParams(location.search)));
    else next=QA.pageUrl('history');
    return QA.pageUrl('login',{next});
  };
  function initClient() {
    if(location.protocol==='file:') throw new Error('Open via http://localhost, not file://. See 00_START_HERE_TH.txt.');
    if(!window.supabase?.createClient) throw new Error('Supabase library could not load. Check your Internet/CDN connection.');
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.supabaseUrl||'') || cfg.supabaseUrl.includes('YOUR_PROJECT'))
      throw new Error('Edit supabaseUrl in config.js first (project HTTPS URL).');
    if(!/^sb_publishable_/.test(cfg.publishableKey||'') || cfg.publishableKey.includes('REPLACE'))
      throw new Error('Edit publishableKey in config.js. Only sb_publishable_ keys are accepted.');
    QA.client=window.supabase.createClient(cfg.supabaseUrl,cfg.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
  }
  async function readProfile(userId) {
    const {data,error}=await QA.client.from('qa_profiles').select('*').eq('user_id',userId).maybeSingle();
    if(error) throw error;
    if(!data?.active) throw new Error('PROFILE_NOT_ACTIVE');
    return data;
  }
  QA.signOut=async()=>{
    if(busy) {QA.notify('A request is still running. Resolve it before signing out.');return;}
    const {error}=await QA.client.auth.signOut({scope:'local'});
    if(error) {QA.notify(error.message);return;}
    QA.forgetJob();
    location.replace(QA.loginUrl());
  };
  async function init() {
    try {
      // Old bookmarks that still point to index.html?job=... must open details,
      // not display the new-notice form. Detect a wrongly uploaded HTML file too.
      const actualPage=document.querySelector('meta[name="qa-page"]')?.content;
      const routePage=pageName(),incomingId=QA.jobIdFromUrl();
      if(actualPage && routePage && actualPage!==routePage) {
        throw new Error('HTML_PAGE_MISMATCH: '+location.pathname+
          ' contains the '+actualPage+' page. Upload the matching V33.1.0 HTML file to GitHub.');
      }
      if(routePage==='create' && incomingId) {location.replace(QA.jobUrl(incomingId));return;}
      initClient();
      const {data,error}=await QA.client.auth.getSession(); if(error) throw error;
      if(isLogin) {
        document.body.classList.remove('qa-auth-loading');
        const form=document.getElementById('loginForm');
        form.addEventListener('submit',async e=>{
          e.preventDefault();const btn=document.getElementById('loginBtn');btn.disabled=true;
          document.getElementById('loginError').textContent='';
          try {
            const email=document.getElementById('email').value.trim();
            const password=document.getElementById('password').value;
            const {data:auth,error:err}=await QA.client.auth.signInWithPassword({email,password});
            if(err) throw err;
            const profile=await readProfile(auth.user.id);
            document.getElementById('password').value='';
            location.replace(safeNext(new URLSearchParams(location.search).get('next'),
              ['qa','admin'].includes(profile.role)?'create':'history'));
          } catch(err) {document.getElementById('loginError').textContent=errorOf(err).message;}
          finally {btn.disabled=false;}
        });
        readyResolve(); return;
      }
      if(!data.session) {location.replace(QA.loginUrl());return;}
      QA.profile=await readProfile(data.session.user.id);
      window.mountQaNavigation?.();
      document.body.classList.remove('qa-auth-loading');
      QA.applyPermissions();
      QA.client.auth.onAuthStateChange((event,session)=>{
        // Keep this callback synchronous: async Auth calls here can deadlock SDK locks.
        if(event==='SIGNED_OUT') {QA.forgetJob();location.replace(QA.loginUrl());}
        if(event==='SIGNED_IN' && session && session.user.id!==QA.profile.user_id) location.reload();
      });
      if(readPending()) showRecovery();
      readyResolve();
    } catch(e) {readyReject(e);fatal(e);}
  }
  document.addEventListener('DOMContentLoaded',init);
  QA.applyPermissions=()=>{
    const p=QA.profile; if(!p) return;
    for(const id of ['issuerName','qaInspector']) {
      const el=document.getElementById(id);
      if(el?.tagName==='INPUT') {el.value=p.display_name;el.defaultValue=p.display_name;el.readOnly=true;}
    }
    const form=document.getElementById('jobForm');
    if(form && !['admin','qa'].includes(p.role)) {
      form.querySelectorAll('input,select,textarea,button').forEach(e=>e.disabled=true);
      QA.notify('This account can view jobs, but only QA/admin can create a new notice. Use Job History or Dashboard.');
    }
    const j=QA.currentJob; if(!j) return;
    const canWork=p.role==='admin'||(p.role==='department'&&p.department===j.toDepartment);
    const canQA=['admin','qa'].includes(p.role);
    if(!canWork) {
      const accept=document.getElementById('acceptCard');if(accept) accept.style.display='none';
      for(const id of ['assigneeName','targetDate','initialAction','preventiveAction','afterImageInput','saveBtn','submitQaBtn']) {
        const el=document.getElementById(id);if(el) el.disabled=true;
      }
    }
    if(!canQA) {
      const el=document.getElementById('qaCard');if(el) el.style.display='none';
      const wait=document.getElementById('waitingCard');if(wait&&j.status==='WAITING_QA') wait.style.display='block';
    }
  };
  function dateTime(v) {
    if(!v) return '';
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v)).replace(',','');
  }
  function keyOf(date=new Date()) {
    const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const get=t=>p.find(x=>x.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`;
  }
  QA.bangkokDateKey=keyOf;
  function mapJob(j) {
    return {jobId:j.job_id,serialNo:j.serial_no,createdDateTime:dateTime(j.created_at),issuerName:j.issuer_name,
      fromDepartment:j.from_department,toDepartment:j.to_department,category:j.category,impact:j.impact,location:j.location,
      downtimeMin:j.downtime_min,problemDetail:j.problem_detail,priority:j.priority,status:j.status,
      assigneeName:j.assignee_name,targetDate:j.target_date||'',initialAction:j.initial_action,preventiveAction:j.preventive_action,
      correctiveDateTime:dateTime(j.corrective_at),qaResult:j.qa_result,qaComment:j.qa_comment,approvedBy:j.approved_by,
      closedDateTime:dateTime(j.closed_at),lastUpdate:dateTime(j.updated_at),version:j.version};
  }
  async function rpc(name,params) {const {data,error}=await QA.client.rpc(name,params);if(error) throw error;return data;}
  async function signedImages(rows) {
    const urls=new Map();
    for(let i=0;i<rows.length;i+=50) {
      const batch=rows.slice(i,i+50);
      const {data,error}=await QA.client.storage.from(cfg.imageBucket).createSignedUrls(batch.map(a=>a.storage_path),cfg.signedUrlSeconds);
      if(error) throw error;
      for(const item of data||[]) {
        if(item.error||!item.signedUrl) throw new Error('Cannot read an image: '+(item.error||item.path));
        urls.set(item.path,item.signedUrl);
      }
    }
    return rows.map(a=>({attachmentId:a.attachment_id,jobId:a.job_id,fileType:a.file_type,fileName:a.file_name,
      storagePath:a.storage_path,url:urls.get(a.storage_path),originalUrl:urls.get(a.storage_path),description:a.description,
      roundNo:a.round_no||0,uploadedBy:a.uploaded_by_name,department:a.department,uploadedDateTime:dateTime(a.uploaded_at)}));
  }
  const api = {
    async getSettings() {
      const result={departments:[],categories:[],priorities:[]};
      const fields={DEPARTMENT:'departments',CATEGORY:'categories',PRIORITY:'priorities'};
      for(let offset=0;;offset+=200) {
        const {data,error}=await QA.client.from('qa_settings').select('*').eq('active',true).order('sort_order').order('setting_type').order('code').range(offset,offset+199);
        if(error) throw error;
        data.forEach(x=>result[fields[x.setting_type]]?.push({code:x.code,name:x.name,sortOrder:x.sort_order}));
        if(data.length<200) break;
      }
      return result;
    },
    async getJob(jobId,options={track:true}) {
      const data=await rpc('qa_get_job',{p_job_id:String(jobId)});
      if(!data?.job) throw new Error('JOB_NOT_FOUND_OR_FORBIDDEN');
      const images=await signedImages(data.attachments||[]), job=mapJob(data.job);
      job.beforeImages=images.filter(a=>a.fileType==='BEFORE');
      job.afterImages=images.filter(a=>a.fileType==='AFTER'&&!a.roundNo);
      job.correctiveLogs=(data.logs||[]).map(l=>({logId:l.log_id,jobId:l.job_id,roundNo:l.round_no,
        dateTime:dateTime(l.submitted_at),assigneeName:l.assignee_name,correctiveAction:l.corrective_action,
        preventiveAction:l.preventive_action,result:l.result,qaComment:l.qa_comment,qaInspector:l.qa_inspector,
        lastUpdate:dateTime(l.updated_at),afterImages:images.filter(a=>a.fileType==='AFTER'&&a.roundNo===l.round_no)}));
      if(options.track!==false){versions.set(job.jobId,job.version);QA.currentJob=job;QA.rememberJob(job.jobId);}
      return {success:true,job};
    },
    async searchJobs(filters={}) {
      if(filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo) throw new Error('Start date must not be after end date.');
      const jobs=[];
      for(let offset=0;;offset+=200) {
        const rows=await rpc('qa_search',{p_filters:filters,p_offset:offset,p_limit:200});
        jobs.push(...rows.map(mapJob));if(rows.length<200) break;
      }
      return {success:true,jobs,total:jobs.length};
    },
    async getDashboardData(filters={}) {
      const period=['day','month','year'].includes(filters.period)?filters.period:'day';
      const today=keyOf();
      const key=String(period==='day'?(filters.date||today):period==='month'?(filters.month||today.slice(0,7)):(filters.year||today.slice(0,4)));
      let start,end;
      if(period==='day') {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid date');
        start=new Date(key+'T00:00:00+07:00');if(isNaN(start)||keyOf(start)!==key) throw new Error('Invalid date');
        end=new Date(+start+86400000);
      } else {
        if(!(period==='month'?/^\d{4}-(0[1-9]|1[0-2])$/:/^\d{4}$/).test(key)) throw new Error('Invalid period');
        const y=Number(key.slice(0,4)),m=period==='month'?Number(key.slice(5,7)):1;
        if(y<1900||y>9998) throw new Error('Year must be 1900-9998');
        start=new Date(`${y}-${String(m).padStart(2,'0')}-01T00:00:00+07:00`);
        end=new Date(Date.UTC(period==='year'?y+1:y,period==='year'?0:m,1)-7*3600000);
      }
      const [settings,rows]=await Promise.all([api.getSettings(),rpc('qa_dashboard',{p_start:start.toISOString(),p_end:end.toISOString()})]);
      const statuses=['OPEN','IN_PROGRESS','WAITING_QA','REWORK','CLOSED'];
      const map=new Map();
      function add(code,name=code){if(!map.has(code))map.set(code,{code,name,displayName:name===code?code:code+' - '+name,statusCounts:Object.fromEntries(statuses.map(s=>[s,0])),other:0,total:0});return map.get(code);}
      settings.departments.filter(x=>x.code.toUpperCase()!=='QA').forEach(x=>add(x.code,x.name));
      rows.forEach(x=>{const d=add(x.department);const n=Number(x.total);d.total+=n;if(statuses.includes(x.status))d.statusCounts[x.status]+=n;else d.other+=n;});
      const departments=[...map.values()],totals=Object.fromEntries([...statuses,'OTHER','TOTAL'].map(s=>[s,0]));
      departments.forEach(d=>{statuses.forEach(s=>totals[s]+=d.statusCounts[s]);totals.OTHER+=d.other;totals.TOTAL+=d.total;});
      return {success:true,period,selectedKey:key,selectedLabel:window.formatDashboardPeriodLabel_(period,key),generatedAt:dateTime(new Date()),statuses,departments,totals,matchedJobs:totals.TOTAL};
    },
    createJob(data){return mutate('CREATE',null,data,data.files||[]);},
    acceptJob(jobId){return mutate('ACCEPT',jobId,{},[]);},
    saveCorrectiveAction(data){return mutate(data.submitToQA===true?'SUBMIT':'SAVE',data.jobId,data,data.files||[]);},
    saveQaVerification(data){return mutate('VERIFY',data.jobId,data,[]);},
    async exportJobPdf(jobId){if(!QA.exportReport)throw new Error('report.js did not load');return QA.exportReport(jobId);}
  };
  QA.api=api;
  QA.prepareFile=async item=>{
    const file=item.file;
    if(!(file instanceof Blob)||!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use JPEG, PNG or WebP images only.');
    if(!file.size||file.size>cfg.maxImageBytes) throw new Error('Each image must be 1 byte to 5 MiB: '+file.name);
    if(file.name.length>255||String(item.description||'').length>1000) throw new Error('File name/description is too long.');
    return {file,fileName:file.name,mimeType:file.type,description:item.description||''};
  };
  const pendingKey=()=>`qa-v33-pending:${new URL(cfg.supabaseUrl).hostname}:${QA.profile.user_id}`;
  function readPending(){try{return JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{return null;}}
  function showRecovery(){
    QA.notify('A save has an unknown outcome. Do not re-enter it as a new job. Use Recover pending save.');
    const note=document.getElementById('qa-system-note');
    const btn=document.createElement('button');btn.textContent='Recover pending save';btn.type='button';btn.style.marginLeft='10px';
    btn.onclick=()=>QA.recoverPending();note.append(btn);
  }
  const isDefinite=e=>typeof e?.code==='string'&&(/^[0-9A-Z]{5}$/.test(e.code)||e.code.startsWith('PGRST'));
  async function sendPending(pending) {
    let last;
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const result=await rpc('qa_mutate',pending.params);
        if(!result?.success) throw new Error('Mutation returned no confirmed result');
        sessionStorage.removeItem(pendingKey());
        if(result.jobId&&result.version&&pending.params.p_action!=='REPORT') versions.set(result.jobId,result.version);
        return result;
      } catch(e) {
        last=e;
        if(isDefinite(e)) {sessionStorage.removeItem(pendingKey());throw e;}
        if(!attempt) await new Promise(r=>setTimeout(r,1000));
      }
    }
    showRecovery();
    throw new Error('Save outcome is unknown; the same request is retained in this tab. '+String(last?.message||last));
  }
  QA.recoverPending=async()=>{
    if(busy)return;busy=true;
    try {const pending=readPending();if(!pending){QA.notify('No pending request');return;}
      const result=await sendPending(pending);QA.openJob(result.jobId,{replace:true});
    } catch(e){QA.notify(errorOf(e).message);if(readPending())showRecovery();}
    finally{busy=false;}
  };
  async function uploadFiles(files,requestId,bucket) {
    if(files.length>cfg.maxFilesPerSave) throw new Error('Maximum 20 new images per save.');
    const uploaded=[];
    for(const item of files) {
      const mime=item.mimeType||item.file.type;
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[mime];
      if(!ext)throw new Error('Unsupported file type');
      const path=`${QA.profile.user_id}/${requestId}/${crypto.randomUUID()}.${ext}`;
      const {error}=await QA.client.storage.from(bucket).upload(path,item.file,{contentType:mime,upsert:false,cacheControl:'3600'});
      if(error)throw new Error(error.message+'; no job change has been sent yet. Some staging files may remain for administrator cleanup.');
      uploaded.push({storage_path:path,file_name:item.fileName,mime_type:mime,size_bytes:item.file.size,description:item.description||''});
    }
    return uploaded;
  }
  async function mutate(action,jobId,data,files=[],overrideVersion) {
    await ready;
    if(busy)throw new Error('Another save is running in this tab.');
    if(readPending())throw new Error('UNRESOLVED_REQUEST');
    busy=true;
    try {
      const requestId=crypto.randomUUID(),bucket=action==='REPORT'?cfg.reportBucket:cfg.imageBucket;
      // Strip binary File objects out of the JSON that goes to PostgreSQL.
      const clean={...data};delete clean.files;
      const expected=action==='CREATE'?null:(overrideVersion??versions.get(jobId));
      if(action!=='CREATE'&&!Number.isInteger(expected))throw new Error('Load the job before saving.');
      if(action!=='REPORT') for(const item of files)await QA.prepareFile({file:item.file,description:item.description});
      const metadata=await uploadFiles(files,requestId,bucket);
      const pending={bucket,params:{p_action:action,p_job_id:jobId,p_data:clean,p_files:metadata,p_request_id:requestId,p_expected_version:expected}};
      // Verify sessionStorage is writable BEFORE issuing a potentially committing request.
      sessionStorage.setItem(pendingKey(),JSON.stringify(pending));
      return await sendPending(pending);
    } finally {busy=false;}
  }
  QA.saveReport=(jobId,version,blob,fileName)=>mutate('REPORT',jobId,{},[{file:blob,fileName,mimeType:'application/pdf',description:''}],version);
  class Runner {
    constructor(success,failure){this.success=success;this.failure=failure;}
    withSuccessHandler(fn){return new Runner(fn,this.failure);}
    withFailureHandler(fn){return new Runner(this.success,fn);}
  }
  for(const name of Object.keys(api))Runner.prototype[name]=function(...args){
    ready.then(()=>api[name](...args)).then(result=>{this.success?.(result);QA.applyPermissions();})
      .catch(e=>{const error=errorOf(e);if(this.failure)this.failure(error);else QA.notify(error.message);});
  };
  Object.defineProperty(QA,'run',{get:()=>new Runner()});
})();
