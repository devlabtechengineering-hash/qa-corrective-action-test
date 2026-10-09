/* QA V37.1.1 navigation/status patch (2026-09-24).
   QA V33 adapter. No Apps Script runtime is required.
   Original callback-shaped calls are preserved as QA.run; the implementation is Supabase.
   Mutation permissions and transitions are enforced in SQL, not by these UI checks. */
(() => {
  'use strict';
  const cfg = window.QA_CONFIG || {};
  cfg.imageBucket=cfg.imageBucket||'qa-images';
  cfg.reportBucket=cfg.reportBucket||'qa-reports';
  cfg.signedUrlSeconds=Math.max(60,Math.min(3600,Number(cfg.signedUrlSeconds)||900));
  cfg.maxImageBytes=Math.max(1,Number(cfg.maxImageBytes)||5*1024*1024);
  cfg.maxFilesPerSave=Math.max(1,Math.min(20,Number(cfg.maxFilesPerSave)||20));
  const QA = window.QA = {profile: null, client: null, version: '37.1.1.4'};
  const versions = new Map();
  let busy = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve,reject) => {readyResolve=resolve;readyReject=reject;});
  ready.catch(() => {});
  // Resolve links from this script's folder, never from the domain root.
  // This works both at / and at /repository-name/ on GitHub Pages.
  const appBase = new URL('.', document.currentScript?.src || location.href);
  const pageFiles = Object.freeze({create:'index.html', index:'index.html',
    job:'job.html', history:'history.html', dashboard:'dashboard.html', work:'work.html', settings:'settings.html', profile:'profile.html', signup:'signup.html', reset:'reset-password.html', forcePassword:'force-password.html', login:'login.html'});
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
    WAITING_REVIEW:'รอผู้แจ้งตรวจรับ',
    REWORK:'ส่งกลับแก้ไข',
    CLOSED:'ปิดงานแล้ว',
    CANCELLED:'ยกเลิกแล้ว'
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
  const currentPage = pageName();
  const isLogin = currentPage==='login';
  const isSignup = currentPage==='signup';
  const messageMap = {
    AUTH_REQUIRED: 'กรุณาเข้าสู่ระบบ',
    PROFILE_NOT_ACTIVE: 'บัญชีนี้ยังรอการอนุมัติ หรือถูกปิดการใช้งาน',
    SYSTEM_ADMIN_REQUIRED: 'เมนูนี้สำหรับ System Admin เท่านั้น',
    DEPARTMENT_ADMIN_REQUIRED: 'การทำรายการนี้ต้องเป็น Department Admin ของแผนกที่เกี่ยวข้อง',
    REQUEST_OWNER_REQUIRED: 'เฉพาะผู้สร้างใบงานหรือ System Admin เท่านั้นที่แก้ไข/ยกเลิกได้',
    JOB_ALREADY_ACCEPTED: 'ใบงานนี้ถูกรับงานแล้ว จึงแก้ไขหรือยกเลิกต้นฉบับไม่ได้',
    STALE_VERSION_REFRESH_REQUIRED: 'มีผู้แก้ไขใบงานแล้ว กรุณาโหลดใหม่ก่อนบันทึก',
    CREATE_ROLE_REQUIRED: 'บัญชี Viewer ไม่สามารถสร้างใบงานได้',
    PROFILE_DEPARTMENT_REQUIRED: 'บัญชีนี้ยังไม่ได้กำหนดแผนกที่ใช้งาน',
    REQUESTER_DEPARTMENT_ROLE_REQUIRED: 'เฉพาะ Department Admin ฝั่งผู้แจ้งหรือ System Admin เท่านั้นที่ตรวจรับ/ปิดงานนี้ได้',
    REQUESTER_ADMIN_REQUIRED: 'เฉพาะ Department Admin ฝั่งผู้แจ้งหรือ System Admin เท่านั้นที่ตรวจรับ/ปิดงานนี้ได้',
    ASSIGNED_DEPARTMENT_ROLE_REQUIRED: 'Only the assigned department or admin can accept/edit this job.',
    JOB_NOT_FOUND_OR_FORBIDDEN: 'Job not found, or your account cannot access it.',
    INVALID_OR_INACTIVE_SETTINGS: 'Select active department, category and priority values from Settings.',
    UNRESOLVED_REQUEST: 'A previous save has an unknown outcome. Click Recover pending save before making another change.',
    ANNOTATION_PERMISSION_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์แก้ไขรูปในสถานะปัจจุบัน',
    CANNOT_DISABLE_OWN_ADMIN: 'ไม่สามารถปิดสิทธิ์ System Admin ของบัญชีที่กำลังใช้งานอยู่ได้',
    LAST_SYSTEM_ADMIN_REQUIRED: 'ระบบต้องมี System Admin ที่ Active และ Approved อย่างน้อย 1 บัญชี',
    ROLLBACK_TO_OPEN_NOT_ALLOWED_AFTER_WORK_DATA: 'ไม่สามารถย้อนกลับเป็น OPEN ได้ เพราะมีข้อมูลการดำเนินงานหรือรูปหลังดำเนินงานแล้ว'
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
  function safeNext(raw, defaultPage='work') {
    const fallback=QA.pageUrl(defaultPage);
    try {
      if(!raw) return fallback;
      const u=new URL(raw,appBase),page=pageName(u.href);
      if(u.username || u.password || !['create','job','history','dashboard','work','settings','profile'].includes(page)) return fallback;
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
    else if(['create','history','dashboard','work','settings','profile'].includes(page)) next=QA.pageUrl(page,Object.fromEntries(new URLSearchParams(location.search)));
    else next=QA.pageUrl('work');
    return QA.pageUrl('login',{next});
  };
  function withTimeout(promise, ms, code='REQUEST_TIMEOUT') {
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),ms);});
    return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
  }
  function initClient() {
    if(location.protocol==='file:') throw new Error('Open via http://localhost, not file://. See 00_START_HERE_TH.txt.');
    if(!window.supabase?.createClient) throw new Error('Supabase library could not load. Check your Internet/CDN connection.');
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.supabaseUrl||'') || cfg.supabaseUrl.includes('YOUR_PROJECT'))
      throw new Error('Edit supabaseUrl in config.js first (project HTTPS URL).');
    const clientKey=String(cfg.publishableKey||cfg.supabaseAnonKey||cfg.anonKey||'').trim();
    if(!clientKey || clientKey.includes('REPLACE') || clientKey.includes('YOUR_'))
      throw new Error('Supabase public key is missing in config.js. Use publishableKey or supabaseAnonKey.');
    QA.client=window.supabase.createClient(cfg.supabaseUrl,clientKey,{
      auth:{persistSession:true,storage:window.sessionStorage,autoRefreshToken:true,detectSessionInUrl:false}
    });
  }
  async function readProfile(userId) {
    const {data,error}=await QA.client.from('qa_profiles').select('*').eq('user_id',userId).maybeSingle();
    if(error) throw error;
    if(!data?.active || (data.approval_status && data.approval_status!=='APPROVED')) throw new Error('PROFILE_NOT_ACTIVE');
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
      const actualPage=document.querySelector('meta[name="qa-page"]')?.content;
      const routePage=pageName(),incomingId=QA.jobIdFromUrl();
      if(actualPage && routePage && actualPage!==routePage) {
        throw new Error('HTML_PAGE_MISMATCH: '+location.pathname+
          ' contains the '+actualPage+' page. Upload the matching V37.1.1 HTML file to GitHub.');
      }
      if(routePage==='create' && incomingId) {location.replace(QA.jobUrl(incomingId));return;}
      initClient();

      // Login must be usable immediately. Do not wait for getSession() before binding the form.
      if(isLogin) {
        document.body.classList.remove('qa-auth-loading');
        const loginParams=new URLSearchParams(location.search);
        const confirmedNote=document.getElementById('emailConfirmedNote');
        if(confirmedNote && loginParams.get('confirmed')==='1') confirmedNote.hidden=false;
        const form=document.getElementById('loginForm');
        const box=document.getElementById('loginError');
        if(!form) throw new Error('LOGIN_FORM_NOT_FOUND');
        form.addEventListener('submit',async e=>{
          e.preventDefault();
          const btn=document.getElementById('loginBtn');
          btn.disabled=true;
          box.style.color='#475569';
          box.textContent='กำลังเข้าสู่ระบบ...';
          try {
            const email=document.getElementById('email').value.trim();
            const password=document.getElementById('password').value;
            const {data:auth,error:err}=await withTimeout(
              QA.client.auth.signInWithPassword({email,password}),15000,'LOGIN_TIMEOUT'
            );
            if(err) throw err;
            if(!auth?.user?.id) throw new Error('LOGIN_NO_USER');
            const profile=await withTimeout(readProfile(auth.user.id),10000,'PROFILE_TIMEOUT');
            document.getElementById('password').value='';
            box.textContent='เข้าสู่ระบบสำเร็จ กำลังเปิดหน้าใบงาน...';
            if(profile.must_change_password) location.replace(QA.pageUrl('forcePassword'));
            else location.replace(QA.pageUrl('work'));
          } catch(err) {
            box.style.color='#b91c1c';
            const code=String(err?.message||err||'');
            if(code==='LOGIN_TIMEOUT') box.textContent='การเชื่อมต่อ Supabase ใช้เวลานานเกินไป กรุณาตรวจ Internet แล้วลองใหม่';
            else if(code==='PROFILE_TIMEOUT') box.textContent='เข้าสู่ระบบได้ แต่โหลดข้อมูลผู้ใช้ไม่สำเร็จ กรุณาลองใหม่';
            else box.textContent=errorOf(err).message;
          } finally {btn.disabled=false;}
        });
        const signupLink=document.getElementById('signupLink');
        if(signupLink) signupLink.href=QA.pageUrl('signup');
        readyResolve();
        return;
      }

      // Signup is public and should not wait for an auth-session check either.
      if(isSignup) {
        document.body.classList.remove('qa-auth-loading');
        try {
          const depts=await withTimeout(rpc('qa_public_departments',{}),10000,'DEPARTMENT_LOAD_TIMEOUT');
          const sel=document.getElementById('department');
          for(const d of depts||[]){const o=document.createElement('option');o.value=d.code;o.textContent=d.code;sel.append(o);}
        } catch(e){document.getElementById('signupError').textContent=errorOf(e).message;}
        const deptRequestBtn=document.getElementById('departmentRequestBtn');
        if(deptRequestBtn) deptRequestBtn.addEventListener('click',async()=>{
          const box=document.getElementById('departmentRequestMsg');box.textContent='';
          const code=document.getElementById('newDepartmentCode').value.trim();
          const name=document.getElementById('newDepartmentName').value.trim();
          const requesterName=document.getElementById('displayName').value.trim();
          const requesterEmail=document.getElementById('email').value.trim();
          if(!code||!name){box.textContent='กรุณากรอกรหัสและชื่อแผนก';return;}
          deptRequestBtn.disabled=true;
          try{
            const result=await withTimeout(rpc('qa_request_department',{p_code:code,p_name:name,p_requester_name:requesterName,p_requester_email:requesterEmail}),10000,'DEPARTMENT_REQUEST_TIMEOUT');
            if(!result?.success) throw new Error('ส่งคำขอไม่สำเร็จ');
            box.style.color='#166534';box.textContent='ส่งคำขอเพิ่มแผนก '+result.code+' แล้ว กรุณารอ System Admin อนุมัติ แล้วกลับมารีเฟรชหน้านี้เพื่อสมัครสมาชิก';
          }catch(err){box.style.color='#b91c1c';box.textContent=errorOf(err).message;}finally{deptRequestBtn.disabled=false;}
        });
        document.getElementById('signupForm').addEventListener('submit',async e=>{
          e.preventDefault();const btn=document.getElementById('signupBtn');btn.disabled=true;
          const box=document.getElementById('signupError');box.textContent='';
          try{
            const display_name=document.getElementById('displayName').value.trim();
            const department=document.getElementById('department').value;
            const email=document.getElementById('email').value.trim();
            const password=document.getElementById('password').value;
            const confirm=document.getElementById('confirmPassword').value;
            if(password.length<8) throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
            if(password!==confirm) throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
            const {data:signup,error:err}=await withTimeout(QA.client.auth.signUp({email,password,options:{emailRedirectTo:QA.pageUrl('login',{confirmed:'1'}),data:{qa_signup:'1',display_name,department}}}),15000,'SIGNUP_TIMEOUT');
            if(err) throw err;
            document.getElementById('signupForm').hidden=true;
            const success=document.getElementById('signupSuccess');
            success.hidden=false;
            if(signup.session){
              success.innerHTML='<b>สมัครสมาชิกสำเร็จ</b><br>บัญชีพร้อมใช้งานแล้ว กำลังเข้าสู่ระบบ...';
              setTimeout(()=>location.replace(QA.pageUrl('work')),600);
            }else{
              success.innerHTML='<b>สมัครสมาชิกสำเร็จ</b><br>ระบบกำลังรอการยืนยันอีเมล กรุณาตรวจ Inbox แล้วกดลิงก์ยืนยันก่อนเข้าสู่ระบบ<br><br><a href="'+QA.pageUrl('login')+'">กลับหน้า Login</a>';
            }
          }catch(err){box.textContent=errorOf(err).message;}finally{btn.disabled=false;}
        });
        readyResolve();
        return;
      }

      const {data,error}=await withTimeout(QA.client.auth.getSession(),10000,'AUTH_SESSION_TIMEOUT');
      if(error) throw error;
      if(!data.session) {location.replace(QA.loginUrl());return;}
      QA.profile=await withTimeout(readProfile(data.session.user.id),10000,'PROFILE_TIMEOUT');
      if(QA.profile.must_change_password && currentPage!=='forcePassword'){
        location.replace(QA.pageUrl('forcePassword'));
        return;
      }
      window.mountQaNavigation?.();
      document.body.classList.remove('qa-auth-loading');
      QA.applyPermissions();
      QA.client.auth.onAuthStateChange((event,session)=>{
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
    const issuer=document.getElementById('issuerName');
    if(issuer?.tagName==='INPUT') {issuer.value=p.display_name;issuer.defaultValue=p.display_name;issuer.readOnly=true;}
    const from=document.getElementById('fromDepartment');
    if(from?.tagName==='INPUT') {from.value=p.department||'';from.defaultValue=p.department||'';from.readOnly=true;}
    const reviewer=document.getElementById('qaInspector');
    if(reviewer?.tagName==='INPUT') {reviewer.value=p.display_name;reviewer.defaultValue=p.display_name;reviewer.readOnly=true;}
    const form=document.getElementById('jobForm');
    if(form && (p.role==='viewer' || !String(p.department||'').trim())) {
      form.querySelectorAll('input,select,textarea,button').forEach(e=>e.disabled=true);
      QA.notify(p.role==='viewer'
        ? 'บัญชี Viewer ดูข้อมูลได้อย่างเดียว ไม่สามารถสร้างใบงานใหม่ได้'
        : 'บัญชีนี้ยังไม่ได้กำหนดแผนกใน qa_profiles จึงยังสร้างใบงานไม่ได้');
    }
    const j=QA.currentJob; if(!j) return;
    const canWork=p.role==='system_admin'||(p.role==='department_admin'&&p.department===j.toDepartment);
    const canReview=p.role==='system_admin'||(p.role==='department_admin'&&p.department===j.fromDepartment);
    if(!canWork) {
      const accept=document.getElementById('acceptCard');if(accept) accept.style.display='none';
      for(const id of ['assigneeName','targetDate','initialAction','preventiveAction','afterImageInput','saveBtn','submitQaBtn']) {
        const el=document.getElementById(id);if(el) el.disabled=true;
      }
    }
    if(!canReview) {
      const el=document.getElementById('qaCard');if(el) el.style.display='none';
      const wait=document.getElementById('waitingCard');if(wait&&j.status==='WAITING_REVIEW') wait.style.display='block';
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
  function formatDashboardPeriodLabel(period,key) {
    if(period==='day') {
      const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key||''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(key||'');
    }
    if(period==='month') {
      const m=/^(\d{4})-(\d{2})$/.exec(String(key||''));
      if(!m) return String(key||'');
      const d=new Date(`${m[1]}-${m[2]}-01T00:00:00+07:00`);
      return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',month:'long',year:'numeric'}).format(d);
    }
    return String(key||'');
  }
  function mapJob(j) {
    return {jobId:j.job_id,serialNo:j.serial_no,createdDateTime:dateTime(j.created_at),issuerName:j.issuer_name,
      fromDepartment:j.from_department,toDepartment:j.to_department,category:j.category,impact:j.impact,location:j.location,
      downtimeMin:j.downtime_min,problemDetail:j.problem_detail,priority:j.priority,status:j.status,
      assigneeName:j.assignee_name,targetDate:j.target_date||'',initialAction:j.initial_action,preventiveAction:j.preventive_action,
      correctiveDateTime:dateTime(j.corrective_at),qaResult:j.qa_result,qaComment:j.qa_comment,approvedBy:j.approved_by,
      closedDateTime:dateTime(j.closed_at),lastUpdate:dateTime(j.updated_at),version:j.version,createdBy:j.created_by,
      acceptedBy:j.accepted_by||'',acceptedAt:dateTime(j.accepted_at),acceptanceComment:j.acceptance_comment||'',acceptanceSignedName:j.acceptance_signed_name||'',cancelledAt:dateTime(j.cancelled_at),cancelReason:j.cancel_reason||''};
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
      const period=['day','month','year'].includes(filters.period)?filters.period:'month';
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
      const settings=await api.getSettings();
      let rows=[];
      if(['system_admin','department_admin'].includes(QA.profile?.role)) {
        const detail=await rpc('qa_dashboard_export',{p_start:start.toISOString(),p_end:end.toISOString()});
        const grouped=new Map();
        for(const job of detail||[]) {
          const department=String(job.to_department||'').trim()||'-';
          const status=String(job.status||'').trim().toUpperCase()||'OTHER';
          const k=department+'\u0000'+status;
          grouped.set(k,(grouped.get(k)||0)+1);
        }
        rows=[...grouped.entries()].map(([k,total])=>{const [department,status]=k.split('\u0000');return {department,status,total};});
      } else {
        rows=await rpc('qa_dashboard',{p_start:start.toISOString(),p_end:end.toISOString()});
      }
      const statuses=['OPEN','IN_PROGRESS','WAITING_REVIEW','REWORK','CLOSED','CANCELLED'];
      const map=new Map();
      function add(code,name=code){if(!map.has(code))map.set(code,{code,name,displayName:name===code?code:code+' - '+name,statusCounts:Object.fromEntries(statuses.map(s=>[s,0])),other:0,total:0});return map.get(code);}
      settings.departments.forEach(x=>add(x.code,x.name));
      rows.forEach(x=>{const d=add(x.department);const n=Number(x.total);d.total+=n;if(statuses.includes(x.status))d.statusCounts[x.status]+=n;else d.other+=n;});
      const departments=[...map.values()],totals=Object.fromEntries([...statuses,'OTHER','TOTAL'].map(s=>[s,0]));
      departments.forEach(d=>{statuses.forEach(s=>totals[s]+=d.statusCounts[s]);totals.OTHER+=d.other;totals.TOTAL+=d.total;});
      return {success:true,period,selectedKey:key,selectedLabel:formatDashboardPeriodLabel(period,key),generatedAt:dateTime(new Date()),statuses,departments,totals,matchedJobs:totals.TOTAL};
    },
    async getWorklist(scope='mine',query=''){const q=String(query||'').trim();const rows=q?await rpc('qa_worklist_search',{p_scope:scope,p_query:q,p_limit:200}):await rpc('qa_worklist',{p_scope:scope,p_limit:200});return {success:true,jobs:(rows||[]).map(mapJob)};},
    async getAdminUsers(){return await rpc('qa_admin_users',{});},
    async updateAdminUser(data){return await rpc('qa_admin_update_user',{p_user_id:data.userId,p_display_name:data.displayName,p_role:data.role,p_department:data.department||'',p_active:!!data.active,p_approval_status:data.approvalStatus});},
    async upsertSetting(data){return await rpc('qa_admin_upsert_setting',{p_type:data.type,p_code:data.code,p_name:data.name,p_sort_order:Number(data.sortOrder)||999,p_active:data.active!==false});},
    async getAdminSettings(){return await rpc('qa_admin_settings',{});},
    async getDepartmentRequests(){return await rpc('qa_admin_department_requests',{});},
    async reviewDepartmentRequest(requestId,approve,reviewNote=''){return await rpc('qa_admin_review_department_request',{p_request_id:requestId,p_approve:!!approve,p_review_note:String(reviewNote||'')});},
    async adminRollbackJob(jobId,targetStatus,reason){
      await ready;
      const expected=versions.get(jobId);
      if(!Number.isInteger(expected)) throw new Error('Load the job before rollback.');
      const result=await rpc('qa_admin_rollback_status',{p_job_id:jobId,p_target_status:targetStatus,p_reason:String(reason||''),p_expected_version:expected});
      if(result?.version) versions.set(jobId,result.version);
      return result;
    },
    async getDashboardExportData(filters={}){
      const period=['day','month','year'].includes(filters.period)?filters.period:'month';
      const today=keyOf();
      const key=String(period==='day'?(filters.date||today):period==='month'?(filters.month||today.slice(0,7)):(filters.year||today.slice(0,4)));
      let start,end;
      if(period==='day'){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid date');
        start=new Date(key+'T00:00:00+07:00'); end=new Date(start.getTime()+86400000);
      }else{
        const valid=period==='month'?/^\d{4}-\d{2}$/.test(key):/^\d{4}$/.test(key); if(!valid) throw new Error('Invalid period');
        const y=Number(key.slice(0,4)),m=period==='month'?Number(key.slice(5,7)):1;
        start=new Date(`${y}-${String(m).padStart(2,'0')}-01T00:00:00+07:00`);
        end=new Date(Date.UTC(period==='year'?y+1:y,period==='year'?0:m,1)-7*3600000);
      }
      const rows=await rpc('qa_dashboard_export',{p_start:start.toISOString(),p_end:end.toISOString()});
      return {success:true,period,selectedKey:key,selectedLabel:formatDashboardPeriodLabel(period,key),rows:rows||[]};
    },
    async adminSetTemporaryPassword(userId,tempPassword){
      const password=String(tempPassword||'');
      if(password.length<8) throw new Error('รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
      const {data,error}=await QA.client.functions.invoke('admin-reset-password',{body:{userId,tempPassword:password}});
      if(error){
        let message=error.message||'เรียก Admin password reset ไม่สำเร็จ';
        try{const detail=await error.context?.json?.();if(detail?.message)message=detail.message;}catch{}
        throw new Error(message);
      }
      if(!data?.success) throw new Error(data?.message||'ตั้งรหัสผ่านชั่วคราวไม่สำเร็จ');
      return data;
    },
    async changeForcedPassword(newPassword){
      const password=String(newPassword||'');
      if(password.length<8) throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      const {error}=await QA.client.auth.updateUser({password});
      if(error) throw error;
      await rpc('qa_clear_must_change_password',{});
      if(QA.profile) QA.profile.must_change_password=false;
      return {success:true};
    },
    createJob(data){return mutate('CREATE',null,data,data.files||[]);},
    updateOpenJob(data){return mutate('UPDATE_OPEN',data.jobId,data,data.files||[]);},
    cancelJob(jobId,reason=''){return mutate('CANCEL',jobId,{reason},[]);},
    acceptJob(jobId,data={}){return mutate('ACCEPT',jobId,{acceptComment:String(data.acceptComment||'')},[]);},
    saveCorrectiveAction(data){return mutate(data.submitToQA===true?'SUBMIT':'SAVE',data.jobId,data,data.files||[]);},
    saveQaVerification(data){return mutate('VERIFY',data.jobId,data,[]);},
    async unlinkLine(){return await rpc('qa_unlink_line',{});},
    async createReportLinks(storagePath,fileName){
      if(!storagePath) throw new Error('REPORT_STORAGE_PATH_REQUIRED');
      const bucket=cfg.reportBucket||'qa-reports';
      const expires=Math.max(60,Math.min(3600,Number(cfg.signedUrlSeconds)||900));
      const preview=await QA.client.storage.from(bucket).createSignedUrl(storagePath,expires);
      if(preview.error) throw preview.error;
      const download=await QA.client.storage.from(bucket).createSignedUrl(storagePath,expires,{download:fileName||true});
      return {previewUrl:preview.data?.signedUrl||'',downloadUrl:download.error?'':(download.data?.signedUrl||'')};
    },
    async saveAnnotatedImage(image,blob){
      if(!(blob instanceof Blob) || blob.type!=='image/png') throw new Error('ANNOTATION_IMAGE_REQUIRED');
      if(!image?.attachmentId) throw new Error('ATTACHMENT_REQUIRED');
      const requestId=crypto.randomUUID();
      const path=`${QA.profile.user_id}/${requestId}/${crypto.randomUUID()}.png`;
      const fileName='annotated-'+String(image.fileName||'image').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-120)+'.png';
      const {error:uploadError}=await QA.client.storage.from(cfg.imageBucket).upload(path,blob,{contentType:'image/png',upsert:false,cacheControl:'3600'});
      if(uploadError) throw uploadError;
      const {data,error}=await QA.client.rpc('qa_save_image_annotation',{p_attachment_id:image.attachmentId,p_storage_path:path,p_file_name:fileName,p_mime_type:'image/png',p_size_bytes:blob.size});
      if(error){try{await QA.client.storage.from(cfg.imageBucket).remove([path]);}catch{}throw error;}
      return data;
    },
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
  const pendingKey=()=>`qa-v35-pending:${new URL(cfg.supabaseUrl).hostname}:${QA.profile.user_id}`;
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
