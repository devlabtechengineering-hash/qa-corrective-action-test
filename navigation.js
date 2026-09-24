/* QA V33.2.1 + company logo: canonical page links, current-job navigation, and LABTECH brand. */
function buildAppNavHtml_(baseUrl, activePage) {
  const safeBase =
    String(baseUrl || '');

  const createUrl =
    QA.pageUrl('create');

  const historyUrl =
    QA.pageUrl('history');

  const dashboardUrl =
    QA.pageUrl('dashboard');

  const createClass =
    activePage === 'create'
      ? 'qa-side-link active'
      : 'qa-side-link';

  const historyClass =
    activePage === 'history'
      ? 'qa-side-link active'
      : 'qa-side-link';

  const dashboardClass =
    activePage === 'dashboard'
      ? 'qa-side-link active'
      : 'qa-side-link';

  const rememberedJob = QA.lastJobId();
  const jobClass = 'qa-side-link qa-current-job-link' + (activePage === 'job' ? ' active' : '');
  const jobUrl = rememberedJob ? QA.jobUrl(rememberedJob) : QA.pageUrl('history');

  return [
    '<style>',

      ':root{',
        '--qa-sidebar-width:236px;',
        '--qa-sidebar-bg:#111827;',
        '--qa-sidebar-border:#253047;',
        '--qa-sidebar-text:#dbe3ef;',
        '--qa-sidebar-muted:#8f9bad;',
        '--qa-sidebar-active:#ffffff;',
        '--qa-sidebar-active-text:#111827;',
      '}',

      '.qa-app-content{',
        'margin-left:var(--qa-sidebar-width);',
        'min-height:100vh;',
      '}',

      '.qa-sidebar{',
        'position:fixed;',
        'left:0;',
        'top:0;',
        'bottom:0;',
        'width:var(--qa-sidebar-width);',
        'background:var(--qa-sidebar-bg);',
        'color:#fff;',
        'z-index:9998;',
        'display:flex;',
        'flex-direction:column;',
        'border-right:1px solid var(--qa-sidebar-border);',
        'box-shadow:6px 0 24px rgba(15,23,42,.08);',
      '}',

      '.qa-side-brand{',
        'padding:14px 14px 16px;',
        'border-bottom:1px solid var(--qa-sidebar-border);',
      '}',

      '.qa-side-brand-row{',
        'display:block;',
      '}',

      '.qa-side-logo{',
        'width:100%;',
        'height:54px;',
        'border-radius:9px;',
        'background:#fff;',
        'display:flex;',
        'align-items:center;',
        'justify-content:center;',
        'overflow:hidden;',
        'margin-bottom:10px;',
      '}',

      '.qa-side-logo img{',
        'display:block;',
        'width:100%;',
        'height:100%;',
        'object-fit:contain;',
        'object-position:left center;',
      '}',

      '.qa-side-brand-title{',
        'font-size:15px;',
        'font-weight:800;',
        'line-height:1.25;',
      '}',

      '.qa-side-brand-sub{',
        'font-size:11px;',
        'color:var(--qa-sidebar-muted);',
        'margin-top:3px;',
      '}',

      '.qa-side-menu{',
        'padding:16px 12px;',
        'overflow-y:auto;',
        'flex:1;',
      '}',

      '.qa-side-label{',
        'padding:0 10px 8px;',
        'font-size:11px;',
        'font-weight:700;',
        'letter-spacing:.08em;',
        'color:var(--qa-sidebar-muted);',
        'text-transform:uppercase;',
      '}',

      '.qa-side-link,',
      '.qa-side-current{',
        'display:flex;',
        'align-items:center;',
        'gap:11px;',
        'width:100%;',
        'padding:11px 12px;',
        'margin-bottom:5px;',
        'border-radius:9px;',
        'color:var(--qa-sidebar-text) !important;',
        'text-decoration:none !important;',
        'font-size:14px;',
        'font-weight:600;',
        'transition:background .15s ease,color .15s ease;',
      '}',

      '.qa-side-link:hover{',
        'background:#1f2937;',
        'color:#fff !important;',
      '}',

      '.qa-side-link.active,',
      '.qa-side-current.active{',
        'background:var(--qa-sidebar-active);',
        'color:var(--qa-sidebar-active-text) !important;',
        'font-weight:800;',
      '}',

      '.qa-side-current{',
        'display:none;',
        'cursor:default;',
      '}',

      '.qa-side-current.active{',
        'display:flex;',
      '}',

      '.qa-side-icon{',
        'width:28px;',
        'height:28px;',
        'border-radius:7px;',
        'display:flex;',
        'align-items:center;',
        'justify-content:center;',
        'background:rgba(255,255,255,.08);',
        'font-size:16px;',
        'font-weight:700;',
        'flex:0 0 auto;',
      '}',

      '.qa-side-link.active .qa-side-icon,',
      '.qa-side-current.active .qa-side-icon{',
        'background:#eef2f7;',
      '}',

      '.qa-side-footer{',
        'padding:13px 18px 18px;',
        'border-top:1px solid var(--qa-sidebar-border);',
        'font-size:11px;',
        'color:var(--qa-sidebar-muted);',
      '}',

      '.qa-mobile-menu-btn{',
        'display:none;',
        'position:fixed;',
        'top:12px;',
        'left:12px;',
        'z-index:10001;',
        'width:42px;',
        'height:42px;',
        'border:0;',
        'border-radius:10px;',
        'background:#111827;',
        'color:#fff;',
        'font-size:22px;',
        'line-height:1;',
        'box-shadow:0 4px 14px rgba(0,0,0,.18);',
        'cursor:pointer;',
      '}',

      '.qa-sidebar-overlay{',
        'display:none;',
      '}',

      '@media(max-width:800px){',

        '.qa-app-content{',
          'margin-left:0;',
          'padding-top:58px;',
        '}',

        '.qa-mobile-menu-btn{',
          'display:block;',
        '}',

        '.qa-sidebar{',
          'transform:translateX(-102%);',
          'transition:transform .2s ease;',
          'box-shadow:10px 0 30px rgba(0,0,0,.18);',
        '}',

        '.qa-menu-open .qa-mobile-menu-btn{left:244px;}',
        '.qa-sidebar.open{',
          'transform:translateX(0);',
        '}',

        '.qa-sidebar-overlay{',
          'position:fixed;',
          'inset:0;',
          'background:rgba(15,23,42,.48);',
          'z-index:9997;',
        '}',

        '.qa-sidebar-overlay.show{',
          'display:block;',
        '}',

      '}',

    '</style>',

    '<button',
      ' type="button"',
      ' class="qa-mobile-menu-btn"',
      ' aria-label="เปิดเมนู"',
      ' onclick="toggleQaSidebar()">',
      '☰',
    '</button>',

    '<div',
      ' id="qaSidebarOverlay"',
      ' class="qa-sidebar-overlay"',
      ' onclick="closeQaSidebar()">',
    '</div>',

    '<aside',
      ' id="qaSidebar"',
      ' class="qa-sidebar">',

      '<div class="qa-side-brand">',
        '<div class="qa-side-brand-row">',
          '<div class="qa-side-logo">',
            '<img src="labtech-logo.png" alt="LABTECH Engineering Company Ltd.">',
          '</div>',
          '<div>',
            '<div class="qa-side-brand-title">',
              'Corrective Action',
            '</div>',
            '<div class="qa-side-brand-sub">',
              'Internal QA System',
            '</div>',
          '</div>',
        '</div>',
      '</div>',

      '<nav class="qa-side-menu">',

        '<div class="qa-side-label">',
          'เมนูหลัก',
        '</div>',

        '<a class="',
          createClass,
          '" href="',
          htmlEscapeServer_(createUrl),
        '">',
          '<span class="qa-side-icon">＋</span>',
          '<span>แจ้งปัญหา</span>',
        '</a>',

        '<a class="',
          historyClass,
          '" href="',
          htmlEscapeServer_(historyUrl),
        '">',
          '<span class="qa-side-icon">⌕</span>',
          '<span>ค้นหาใบงาน</span>',
        '</a>',

        '<a class="',
          dashboardClass,
          '" href="',
          htmlEscapeServer_(dashboardUrl),
        '">',
          '<span class="qa-side-icon">▥</span>',
          '<span>Dashboard</span>',
        '</a>',

        '<a id="qa-current-job-link" class="',jobClass,'" href="',htmlEscapeServer_(jobUrl),'"',
          ' style="',rememberedJob?'':'display:none;','"',
          activePage==='job'?' aria-current="page"':'','>',
          '<span class="qa-side-icon">&#9636;</span>',
          '<span><span>&#3651;&#3610;&#3591;&#3634;&#3609;&#3611;&#3633;&#3592;&#3592;&#3640;&#3610;&#3633;&#3609;</span>',
          '<small id="qa-current-job-id" style="display:block;font-size:11px;margin-top:4px;overflow-wrap:anywhere;">',
            htmlEscapeServer_(rememberedJob),'</small></span>',
        '</a>',

      '</nav>',

      '<div class="qa-side-footer">',
        'QA Corrective Action System',
        '<div id="qa-release-version" style="margin:6px 0;">V33.1.0</div>',
      '</div>',

    '</aside>',

    '<script>',
      'function toggleQaSidebar(){',
        'var s=document.getElementById("qaSidebar");',
        'var o=document.getElementById("qaSidebarOverlay");',
        'if(!s||!o)return;',
        'var open=s.classList.toggle("open");',
        'o.classList.toggle("show",open);',
      '}',

      'function closeQaSidebar(){',
        'var s=document.getElementById("qaSidebar");',
        'var o=document.getElementById("qaSidebarOverlay");',
        'if(s)s.classList.remove("open");',
        'if(o)o.classList.remove("show");',
      '}',

      'window.addEventListener("resize",function(){',
        'if(window.innerWidth>800){',
          'closeQaSidebar();',
        '}',
      '});',
    '</script>'

  ].join('');
}


function htmlEscapeServer_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}



window.toggleQaSidebar=function(){
 const s=document.getElementById('qaSidebar'),o=document.getElementById('qaSidebarOverlay');
 if(!s||!o)return;const open=s.classList.toggle('open');o.classList.toggle('show',open);document.body.classList.toggle('qa-menu-open',open);document.querySelector('.qa-mobile-menu-btn')?.setAttribute('aria-expanded',String(open));
};
window.closeQaSidebar=function(){document.body.classList.remove('qa-menu-open');document.querySelector('.qa-mobile-menu-btn')?.setAttribute('aria-expanded','false');document.getElementById('qaSidebar')?.classList.remove('open');document.getElementById('qaSidebarOverlay')?.classList.remove('show');};
window.addEventListener('resize',()=>{if(innerWidth>800)closeQaSidebar();});
window.refreshQaCurrentJobLink=function(jobId=QA.lastJobId()){
 const link=document.getElementById('qa-current-job-link');if(!link)return;
 const id=String(jobId||'');link.style.display=id?'flex':'none';
 link.href=id?QA.jobUrl(id):QA.pageUrl('history');
 const label=document.getElementById('qa-current-job-id');if(label)label.textContent=id;
};
window.mountQaNavigation=function(){
 if(document.getElementById('qaSidebar')) return;
 const active=QA.pageName() || 'create';
 const content=document.createElement('div');content.className='qa-app-content';
 [...document.body.childNodes].forEach(n=>{if(n.nodeName!=='SCRIPT')content.append(n);});
 document.body.append(content);
 document.body.insertAdjacentHTML('afterbegin',buildAppNavHtml_('',active).replace(/<script>[\s\S]*?<\/script>/gi,''));
 const footer=document.querySelector('.qa-side-footer');
 if(footer){const user=document.createElement('div');user.style.cssText='margin-bottom:12px;overflow-wrap:anywhere';
 user.textContent=QA.profile.display_name+' | '+QA.profile.role+' | '+QA.profile.department;
 const out=document.createElement('button');out.type='button';out.textContent='Sign out';out.onclick=()=>QA.signOut();
 out.style.cssText='padding:8px 14px;font-size:13px;color:#111;background:#fff;border-radius:6px;border:0;';footer.append(user,out);}
};

function formatDashboardPeriodLabel_(
  period,
  key
) {
  const monthNames = [
    'มกราคม',
    'กุมภาพันธ์',
    'มีนาคม',
    'เมษายน',
    'พฤษภาคม',
    'มิถุนายน',
    'กรกฎาคม',
    'สิงหาคม',
    'กันยายน',
    'ตุลาคม',
    'พฤศจิกายน',
    'ธันวาคม'
  ];

  if (period === 'day') {
    const parts =
      String(key || '')
        .split('-');

    if (parts.length === 3) {
      const year =
        Number(parts[0]);

      const month =
        Number(parts[1]);

      const day =
        Number(parts[2]);

      return (
        day +
        ' ' +
        (monthNames[month - 1] || '') +
        ' ' +
        (year + 543)
      );
    }

    return key;
  }

  if (period === 'month') {
    const parts =
      String(key || '')
        .split('-');

    if (parts.length === 2) {
      const year =
        Number(parts[0]);

      const month =
        Number(parts[1]);

      return (
        (monthNames[month - 1] || '') +
        ' ' +
        (year + 543)
      );
    }

    return key;
  }

  if (period === 'year') {
    const year =
      Number(key);

    if (year) {
      return String(year + 543);
    }

    return key;
  }

  return key;
}


