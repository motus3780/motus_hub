// 관리자 페이지 HTML

export function renderSetupPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>초기 셋업 | 모투스 위클리</title>
  <link href="/static/style.css" rel="stylesheet">
</head>
<body style="background:linear-gradient(135deg,#2c3e50 0%,#3498db 100%);min-height:100vh;">
  <main class="container" style="padding:40px 20px;max-width:720px;">
    <div class="card" style="padding:36px;">
      <h1 style="margin:0 0 8px;">🚀 모투스 위클리 초기 셋업</h1>
      <p style="color:#7f8c8d;margin-bottom:24px;">아래 정보를 입력하면 서비스를 시작할 수 있습니다.</p>

      <form id="setup-form">
        <h3 style="margin:24px 0 12px;color:#2c3e50;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">1. 관리자 계정</h3>
        <div class="form-group">
          <label>관리자 ID</label>
          <input name="username" required placeholder="admin">
        </div>
        <div class="form-group">
          <label>비밀번호 (4자 이상)</label>
          <input name="password" type="password" required minlength="4">
        </div>

        <h3 style="margin:24px 0 12px;color:#2c3e50;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">2. 네이버 검색 API</h3>
        <div style="font-size:12px;color:#7f8c8d;margin-bottom:8px;">발급: <a href="https://developers.naver.com/apps/#/register" target="_blank">developers.naver.com</a></div>
        <div class="form-group">
          <label>Client ID</label>
          <input name="naver_client_id" placeholder="네이버 검색 API Client ID">
        </div>
        <div class="form-group">
          <label>Client Secret</label>
          <input name="naver_client_secret" type="password" placeholder="네이버 검색 API Client Secret">
        </div>

        <h3 style="margin:24px 0 12px;color:#2c3e50;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">3. Anthropic Claude API</h3>
        <div style="font-size:12px;color:#7f8c8d;margin-bottom:8px;">발급: <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a></div>
        <div class="form-group">
          <label>API Key</label>
          <input name="claude_api_key" type="password" placeholder="sk-ant-...">
        </div>
        <div class="form-group">
          <label>모델명 (선택)</label>
          <input name="claude_model" placeholder="claude-haiku-4-5-20251001">
          <div class="hint">기본값: claude-haiku-4-5-20251001</div>
        </div>

        <h3 style="margin:24px 0 12px;color:#2c3e50;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">4. 이메일 발송 (Resend)</h3>
        <div style="font-size:12px;color:#7f8c8d;margin-bottom:8px;">발급: <a href="https://resend.com/api-keys" target="_blank">resend.com/api-keys</a> (월 3,000통 무료)</div>
        <div class="form-group">
          <label>Resend API Key</label>
          <input name="resend_api_key" type="password" placeholder="re_...">
          <div class="hint">환경변수 <code>RESEND_API_KEY</code>로도 설정 가능 (환경변수가 우선 적용됨)</div>
        </div>
        <div class="form-group">
          <label>발신자 표시 이름</label>
          <input name="sender_name" value="모투스 위클리">
        </div>
        <div class="form-group">
          <label>발신자 이메일 주소</label>
          <input name="sender_email" type="email" placeholder="onboarding@resend.dev">
          <div class="hint">기본값: <code>onboarding@resend.dev</code> (Resend 테스트용, 본인 이메일로만 수신 가능). 자체 도메인 사용 시 Resend에서 도메인 인증 필요.</div>
        </div>

        <h3 style="margin:24px 0 12px;color:#2c3e50;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">5. 사이트 정보</h3>
        <div class="form-group">
          <label>사이트 URL (이메일 링크에 사용)</label>
          <input name="site_url" placeholder="https://your-domain.pages.dev">
        </div>
        <div class="form-group">
          <label>발송 시각 (KST 시간, 0~23)</label>
          <input name="send_hour_kst" type="number" min="0" max="23" value="9">
          <div class="hint">매일 이 시각(한국시간)에 자동으로 뉴스를 수집·발송합니다.</div>
        </div>
        <div class="form-group">
          <label>회사 로고 URL (선택)</label>
          <input name="company_logo_url" placeholder="https://...">
          <div class="hint">로그인 후 관리자 페이지에서 이미지 업로드도 가능합니다.</div>
        </div>

        <div style="text-align:center;margin-top:30px;">
          <button type="submit" class="btn" style="padding:14px 36px;font-size:16px;">셋업 완료하고 시작하기</button>
        </div>
      </form>
    </div>
  </main>
  <script>
    document.getElementById('setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {};
      for (const [k, v] of fd.entries()) data[k] = v;
      const r = await fetch('/admin/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data)
      }).then(r => r.json());
      if (r.error) { alert(r.error); return; }
      alert('셋업이 완료되었습니다! 관리자 로그인 페이지로 이동합니다.');
      location.href = '/admin/login';
    });
  </script>
</body>
</html>`
}

export function renderLoginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>관리자 로그인</title>
  <link href="/static/style.css" rel="stylesheet">
</head>
<body style="background:linear-gradient(135deg,#2c3e50 0%,#3498db 100%);min-height:100vh;display:flex;align-items:center;">
  <main class="container" style="max-width:420px;">
    <div class="card" style="padding:36px;">
      <h1 style="margin:0 0 6px;text-align:center;">🔐 관리자 로그인</h1>
      <p style="color:#7f8c8d;text-align:center;margin-bottom:24px;font-size:13px;">모투스 위클리</p>
      ${error ? `<div style="background:#fce4e4;color:#e74c3c;padding:10px;border-radius:8px;margin-bottom:16px;font-size:13px;">${error}</div>` : ''}
      <form id="login-form">
        <div class="form-group">
          <label>관리자 ID</label>
          <input name="username" required>
        </div>
        <div class="form-group">
          <label>비밀번호</label>
          <input name="password" type="password" required>
        </div>
        <button type="submit" class="btn" style="width:100%;padding:12px;">로그인</button>
      </form>
    </div>
    <div style="text-align:center;margin-top:14px;"><a href="/" style="color:rgba(255,255,255,0.85);font-size:13px;">← 메인으로</a></div>
  </main>
  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') })
      }).then(r => r.json());
      if (r.error) { alert(r.error); return; }
      location.href = '/admin/dashboard';
    });
  </script>
</body>
</html>`
}

const adminLayout = (currentMenu: string, content: string, title: string = '관리자') => `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title} | 모투스 위클리 관리자</title>
  <link href="/static/style.css" rel="stylesheet">
</head>
<body>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <h2>🏗️ 모투스 위클리<br><span style="font-size:11px;font-weight:400;opacity:0.7;">관리자 콘솔</span></h2>
      <nav>
        <a href="/admin/dashboard" class="${currentMenu === 'dashboard' ? 'active' : ''}">📊 대시보드</a>
        <a href="/admin/personalized-review" class="${currentMenu === 'personalized-review' ? 'active' : ''}">✅ 위클리 검수</a>
        <a href="/admin/weekly-images" class="${currentMenu === 'weekly-images' ? 'active' : ''}">🖼️ 위클리 이미지</a>
        <a href="/admin/contents" class="${currentMenu === 'contents' ? 'active' : ''}">🎯 자사 콘텐츠</a>
        <a href="/admin/news-search" class="${currentMenu === 'news-search' ? 'active' : ''}">🔍 뉴스 검색</a>
        <a href="/admin/media-mapping" class="${currentMenu === 'media-mapping' ? 'active' : ''}">📰 언론사 매핑</a>
        <a href="/admin/subscribers" class="${currentMenu === 'subscribers' ? 'active' : ''}">👥 구독자</a>
        <a href="/admin/email-logs" class="${currentMenu === 'logs' ? 'active' : ''}">📧 발송 이력</a>
        <a href="/admin/settings" class="${currentMenu === 'settings' ? 'active' : ''}">⚙️ 환경 설정</a>
        <a href="#" onclick="logout();return false;">🚪 로그아웃</a>
      </nav>
    </aside>
    <main class="admin-main">
      ${content}
    </main>
  </div>
  <script src="/static/admin.js"></script>
</body>
</html>`

export function renderDashboardPage(): string {
  return adminLayout('dashboard', `
    <h1>📊 대시보드</h1>

    <!-- 자동 실행 상태 배지 -->
    <div id="auto-job-badge" class="auto-badge auto-badge-loading">
      <span class="auto-badge-icon">⏳</span>
      <span class="auto-badge-text">자동 실행 상태 확인 중...</span>
    </div>

    <div id="dashboard-stats" class="stat-grid"></div>
    <div class="card">
      <h3 class="card-title" style="font-size:16px;">⚡ 즉시 실행</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary" onclick="runCollect()">🔄 지금 뉴스 수집 + AI 요약</button>
      </div>
      <div id="run-result" style="margin-top:16px;"></div>
    </div>
    <div class="card">
      <h3 class="card-title" style="font-size:16px;">📈 최근 7일 발송 추이</h3>
      <canvas id="trend-chart" style="max-height:240px;"></canvas>
    </div>

    <div class="card">
      <h3 class="card-title" style="font-size:16px;">🤖 자동 실행 로그 (최근 20건)</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>시작 시각 (KST)</th>
              <th>유형</th>
              <th>트리거</th>
              <th>상태</th>
              <th>처리</th>
              <th>오류</th>
            </tr>
          </thead>
          <tbody id="auto-job-logs-tbody">
            <tr><td colspan="6" style="text-align:center;color:#95a5a6;padding:24px;">로딩 중...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `, '대시보드')
}

export function renderContentsPage(): string {
  return adminLayout('contents', `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <h1 style="margin:0;">🎯 자사 콘텐츠 관리</h1>
      <a href="/admin/contents/new" class="btn">+ 새 콘텐츠 등록</a>
    </div>
    <div class="card" style="margin-top:20px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <input id="filter-search" placeholder="키워드 검색" style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #dfe6ed;border-radius:8px;">
        <select id="filter-category" style="padding:8px;border:1px solid #dfe6ed;border-radius:8px;">
          <option value="">전체 카테고리</option>
          <option value="신규 상품">신규 상품</option>
          <option value="이벤트/프로모션">이벤트/프로모션</option>
          <option value="공지사항">공지사항</option>
          <option value="회사 소식">회사 소식</option>
        </select>
        <select id="filter-status" style="padding:8px;border:1px solid #dfe6ed;border-radius:8px;">
          <option value="">전체 상태</option>
          <option value="published">발행</option>
          <option value="draft">임시저장</option>
        </select>
        <button class="btn btn-secondary" onclick="loadContents()">검색</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>제목</th>
              <th>카테고리</th>
              <th>상태</th>
              <th>노출 기간</th>
              <th>이메일</th>
              <th>고정</th>
              <th>조회/클릭</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody id="contents-tbody"></tbody>
        </table>
      </div>
    </div>
  `, '자사 콘텐츠')
}

export function renderContentEditPage(id?: number): string {
  return adminLayout('contents', `
    <h1>${id ? '✏️ 콘텐츠 수정' : '➕ 새 콘텐츠 등록'}</h1>
    <div class="card">
      <form id="content-form">
        <input type="hidden" name="id" value="${id || ''}">
        <div class="form-group">
          <label>제목 *</label>
          <input name="title" required>
        </div>
        <div class="form-group">
          <label>카테고리 *</label>
          <select name="category" required>
            <option value="신규 상품">신규 상품</option>
            <option value="이벤트/프로모션">이벤트/프로모션</option>
            <option value="공지사항">공지사항</option>
            <option value="회사 소식">회사 소식</option>
          </select>
        </div>
        <div class="form-group">
          <label>본문 (마크다운 지원) *</label>
          <textarea name="body" required style="min-height:240px;font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;"></textarea>
          <div class="hint"># 제목, **굵게**, *기울임*, [링크](url), ![이미지](url), - 리스트 사용 가능</div>
        </div>
        <div class="form-group">
          <label>대표 이미지</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input name="image_url" id="image-url-input" placeholder="이미지 URL 또는 업로드">
            <input type="file" id="image-file" accept="image/*" style="display:none;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('image-file').click()">📁 업로드</button>
          </div>
          <div id="image-preview" style="margin-top:10px;"></div>
        </div>
        <div class="form-group">
          <label>외부 링크 (선택)</label>
          <input name="external_link" placeholder="https://...">
          <div class="hint">입력 시 카드 클릭 시 이 URL로 이동, 클릭 수가 추적됩니다.</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group">
            <label>노출 시작일</label>
            <input name="start_date" type="date">
          </div>
          <div class="form-group">
            <label>노출 종료일</label>
            <input name="end_date" type="date">
          </div>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin:14px 0;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" name="show_in_email" value="1" checked> 📧 이메일 노출
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" name="is_pinned" value="1"> 📌 고정 (최상단)
          </label>
        </div>
        <div class="form-group">
          <label>상태</label>
          <select name="status">
            <option value="draft">임시저장</option>
            <option value="published">발행</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <a href="/admin/contents" class="btn btn-secondary">취소</a>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div>
  `, id ? '콘텐츠 수정' : '새 콘텐츠')
}

export function renderSubscribersPage(): string {
  return adminLayout('subscribers', `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <h1 style="margin:0;">👥 구독자 관리</h1>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" onclick="addSubscriberPrompt()">+ 수동 추가</button>
        <a href="/admin/api/subscribers.csv" class="btn btn-secondary">📥 CSV 내보내기</a>
      </div>
    </div>
    <div id="sub-stats" class="stat-grid" style="margin-top:20px;"></div>
    <div class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <input id="sub-search" placeholder="이메일/이름 검색" style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #dfe6ed;border-radius:8px;">
        <select id="sub-active" style="padding:8px;border:1px solid #dfe6ed;border-radius:8px;">
          <option value="">전체</option>
          <option value="1">활성</option>
          <option value="0">해지</option>
        </select>
        <button class="btn btn-secondary" onclick="loadSubscribers()">검색</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>이메일</th><th>이름</th><th>상태</th><th>가입일</th><th>작업</th></tr>
          </thead>
          <tbody id="subscribers-tbody"></tbody>
        </table>
      </div>
    </div>
  `, '구독자')
}

export function renderEmailLogsPage(): string {
  return adminLayout('logs', `
    <h1>📧 발송 이력</h1>

    <!-- 발송 작업(send_jobs) 요약 -->
    <div class="card">
      <h3 class="card-title" style="font-size:16px;margin-bottom:12px;">🗂️ 발송 작업 (Job 단위)</h3>
      <p style="color:#7f8c8d;font-size:13px;margin-bottom:10px;">
        같은 날짜의 동일한 발송 작업은 <code>job_id</code> (예: <code>newsletter_2026-05-09</code>)로 식별되어 중복 발송이 차단됩니다.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job ID</th><th>예정 날짜</th><th>트리거</th><th>상태</th>
              <th>대상/성공/실패</th><th>시작 (KST)</th><th>완료 (KST)</th><th>상세</th>
            </tr>
          </thead>
          <tbody id="send-jobs-tbody"><tr><td colspan="8" style="text-align:center;color:#7f8c8d;padding:14px;">로딩 중...</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- 선택된 Job의 상세 -->
    <div class="card" id="send-job-detail-card" style="display:none;">
      <h3 class="card-title" style="font-size:16px;margin-bottom:12px;">📋 선택된 작업 상세</h3>
      <div id="send-job-detail-meta" style="font-size:13px;color:#34495e;margin-bottom:10px;line-height:1.7;"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>수신자</th><th>상태</th><th>시도 수</th><th>오류 코드</th><th>오류 메시지</th><th>발송 시각 (KST)</th></tr>
          </thead>
          <tbody id="send-job-logs-tbody"></tbody>
        </table>
      </div>
    </div>

    <!-- 기존 email_logs (호환용) -->
    <div class="card">
      <h3 class="card-title" style="font-size:16px;margin-bottom:12px;">✉️ 개별 발송 로그</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <input id="log-date" type="date" style="padding:8px;border:1px solid #dfe6ed;border-radius:8px;">
        <button class="btn btn-secondary" onclick="loadLogs()">조회</button>
        <button class="btn btn-secondary" onclick="document.getElementById('log-date').value='';loadLogs()">전체</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>시각 (KST)</th><th>날짜</th><th>수신자</th><th>이름</th><th>상태</th><th>오류</th></tr>
          </thead>
          <tbody id="logs-tbody"></tbody>
        </table>
      </div>
    </div>
  `, '발송 이력')
}

export function renderAdminNewsSearchPage(): string {
  return adminLayout('news-search', `
    <h1>🔍 뉴스 검색 (사전 검토)</h1>
    <p style="color:#7f8c8d;font-size:13px;margin-bottom:14px;">수집된 뉴스를 키워드/카테고리/기간/언론사로 검색합니다. 구독자에게 노출되기 전 사전 검토 용도로도 사용하세요.</p>

    <div class="card">
      <form id="search-form" class="search-form">
        <div class="search-row">
          <input id="sf-q" type="text" placeholder="검색어 입력 (제목, 본문)" autocomplete="off" />
          <button type="submit" class="btn">검색</button>
        </div>
        <div class="search-filters">
          <div class="sf-group">
            <label>카테고리</label>
            <select id="sf-group">
              <option value="">전체</option>
              <option value="부동산">🏢 부동산</option>
              <option value="도시정비">🏗️ 도시정비</option>
              <option value="광고/매체">📺 광고/매체</option>
              <option value="AI">🤖 AI</option>
              <option value="기타">📌 기타</option>
            </select>
          </div>
          <div class="sf-group" id="sf-subcat-wrap" style="display:none;">
            <label>하위 분류</label>
            <select id="sf-subcat">
              <option value="">전체</option>
              <option value="옥외광고">옥외광고</option>
              <option value="디지털광고">디지털광고</option>
              <option value="광고산업">광고산업</option>
              <option value="미디어">미디어</option>
              <option value="광고규제">광고규제</option>
            </select>
          </div>
          <div class="sf-group">
            <label>기간</label>
            <select id="sf-period">
              <option value="">전체</option>
              <option value="today">오늘</option>
              <option value="7">1주일</option>
              <option value="30">1개월</option>
              <option value="90">3개월</option>
              <option value="custom">직접 지정</option>
            </select>
          </div>
          <div class="sf-group sf-custom" style="display:none;">
            <label>시작</label>
            <input id="sf-start" type="date" />
          </div>
          <div class="sf-group sf-custom" style="display:none;">
            <label>종료</label>
            <input id="sf-end" type="date" />
          </div>
          <div class="sf-group">
            <label>언론사</label>
            <select id="sf-source"><option value="">전체</option></select>
          </div>
          <div class="sf-group">
            <label>정렬</label>
            <select id="sf-sort">
              <option value="recent">최신순</option>
              <option value="relevance">관련도순</option>
            </select>
          </div>
        </div>
      </form>
    </div>

    <div class="card">
      <div id="search-meta" style="font-size:13px;color:#7f8c8d;margin-bottom:14px;">검색어/필터를 선택하세요.</div>
      <div id="search-results"></div>
      <div id="search-pagination" class="pagination"></div>
    </div>

    <script src="/static/search.js"></script>
  `, '뉴스 검색')
}

export function renderMediaMappingPage(): string {
  return adminLayout('media-mapping', `
    <h1>📰 언론사 매핑 관리</h1>
    <p style="color:#7f8c8d;font-size:13px;margin-bottom:14px;">
      뉴스 URL의 도메인을 한글 언론사명으로 매핑합니다. 이미 등록된 기본 매핑(중앙일보, 매일경제 등)은 그대로 유지되며, 여기에 추가/수정한 매핑은 우선 적용됩니다.
    </p>

    <div class="card">
      <h3 class="card-title" style="font-size:16px;">➕ 새 매핑 추가</h3>
      <form id="mm-add-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="flex:1;min-width:240px;margin:0;">
          <label>도메인 (예: housingherald.co.kr)</label>
          <input id="mm-domain" placeholder="example.com" required>
        </div>
        <div class="form-group" style="flex:1;min-width:200px;margin:0;">
          <label>언론사명</label>
          <input id="mm-name" placeholder="하우징헤럴드" required>
        </div>
        <button type="submit" class="btn">추가</button>
      </form>
      <div id="mm-add-result" style="margin-top:10px;font-size:13px;"></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h3 class="card-title" style="font-size:16px;margin:0;">📌 사용자 추가 매핑</h3>
        <div style="font-size:12px;color:#7f8c8d;">기본 매핑 위에 우선 적용됩니다</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>도메인</th><th>언론사명</th><th style="width:120px;">작업</th></tr>
          </thead>
          <tbody id="mm-custom-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title" style="font-size:16px;">📚 기본 매핑 (시스템 제공)</h3>
      <div style="font-size:12px;color:#7f8c8d;margin-bottom:10px;">${'기본 매핑은 코드에 내장되어 있습니다. 수정하려면 위에서 동일 도메인으로 사용자 매핑을 추가하면 덮어씌워집니다.'}</div>
      <div class="table-wrap" style="max-height:480px;overflow-y:auto;">
        <table>
          <thead><tr><th>도메인</th><th>언론사명</th></tr></thead>
          <tbody id="mm-default-tbody"></tbody>
        </table>
      </div>
    </div>

    <script src="/static/media-mapping.js"></script>
  `, '언론사 매핑')
}

export function renderSettingsPage(): string {
  return adminLayout('settings', `
    <h1>⚙️ 환경 설정</h1>
    <div class="card">
      <form id="settings-form">
        <h3 style="margin:0 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">네이버 검색 API</h3>
        <div class="form-group"><label>Client ID</label><input name="naver_client_id"></div>
        <div class="form-group"><label>Client Secret</label><input name="naver_client_secret" type="password" placeholder="변경 시에만 입력"></div>

        <h3 style="margin:24px 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">Claude API</h3>
        <div class="form-group"><label>API Key</label><input name="claude_api_key" type="password" placeholder="변경 시에만 입력"></div>
        <div class="form-group"><label>모델</label><input name="claude_model" placeholder="claude-haiku-4-5-20251001"></div>

        <h3 style="margin:24px 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">이메일 발송 (Resend)</h3>
        <div class="form-group">
          <label>Resend API Key</label>
          <input name="resend_api_key" type="password" placeholder="변경 시에만 입력 (re_...)">
          <div class="hint">환경변수 <code>RESEND_API_KEY</code>가 설정되어 있으면 그 값이 우선 적용됩니다. 발급: <a href="https://resend.com/api-keys" target="_blank">resend.com/api-keys</a></div>
        </div>
        <div class="form-group"><label>발신자 표시 이름</label><input name="sender_name"></div>
        <div class="form-group">
          <label>발신자 이메일</label>
          <input name="sender_email" type="email" placeholder="onboarding@resend.dev">
          <div class="hint">기본값: <code>onboarding@resend.dev</code> (도메인 인증 없이 본인 이메일에만 수신 가능)</div>
        </div>

        <div style="background:#f8fafc;border:1px solid #ecf0f1;border-radius:8px;padding:14px;margin:14px 0;">
          <div style="font-weight:700;color:#2c3e50;margin-bottom:8px;">📧 테스트 발송</div>
          <div style="font-size:12px;color:#7f8c8d;margin-bottom:10px;">현재 설정으로 본인 이메일에 1통만 발송하여 발송 환경을 테스트할 수 있습니다.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input id="test-send-to" type="email" placeholder="수신할 본인 이메일 주소" style="flex:1;min-width:220px;padding:10px 12px;border:1px solid #dfe6ed;border-radius:8px;">
            <button type="button" class="btn" onclick="testSend()">테스트 발송</button>
          </div>
          <div id="test-send-result" style="margin-top:10px;font-size:13px;"></div>
        </div>

        <h3 style="margin:24px 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">🤖 자동 실행 (Cron)</h3>
        <div class="hint" style="margin-bottom:14px;">시각은 모두 <strong>Asia/Seoul (KST)</strong> 기준입니다. Cloudflare Workers Cron은 UTC로 발화되지만, 서버에서 KST로 변환하여 매칭합니다.</div>

        <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <label class="switch">
            <input type="checkbox" name="auto_collect_enabled" value="1">
            <span class="slider"></span>
          </label>
          <label style="margin:0;">자동 수집·요약 활성화</label>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <label class="switch">
            <input type="checkbox" name="auto_send_enabled" value="1">
            <span class="slider"></span>
          </label>
          <label style="margin:0;">자동 발송 활성화</label>
        </div>

        <div class="form-group">
          <label>수집·요약 시각 (HH:MM, KST)</label>
          <input name="auto_collect_time_kst" type="time" placeholder="06:30">
          <div class="hint">기본값 <code>06:30</code> · 매일 이 시각에 뉴스 수집 + AI 요약이 자동 실행됩니다.</div>
        </div>
        <div class="form-group">
          <label>발송 시각 (HH:MM, KST)</label>
          <input name="auto_send_time_kst" type="time" placeholder="07:30">
          <div class="hint">기본값 <code>07:30</code> · 수집·요약 시각보다 <strong>최소 30분 이후</strong>여야 합니다.</div>
          <div id="auto-time-warning" style="margin-top:6px;font-size:13px;color:#e74c3c;display:none;"></div>
        </div>

        <div class="form-group">
          <label>실패 알림 수신 이메일</label>
          <input name="admin_alert_email" type="email" placeholder="seokjun7127@gmail.com">
          <div class="hint">자동 실행 3회 재시도 모두 실패 시 이 주소로 알림을 발송합니다.</div>
        </div>

        <div id="auto-job-info" style="background:#f8fafc;border:1px solid #ecf0f1;border-radius:8px;padding:14px;margin:14px 0;font-size:13px;line-height:1.8;color:#2c3e50;">
          <div style="font-weight:700;margin-bottom:6px;">📅 다음 자동 실행 예정 시각</div>
          <div id="next-collect-time">수집: 로딩 중...</div>
          <div id="next-send-time">발송: 로딩 중...</div>
          <div style="font-weight:700;margin:14px 0 6px;">🕘 마지막 자동 실행 결과</div>
          <div id="last-collect-result">수집·요약: 기록 없음</div>
          <div id="last-send-result">발송: 기록 없음</div>
        </div>

        <h3 style="margin:24px 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">📰 수집 카테고리 활성화</h3>
        <div class="hint" style="margin-bottom:14px;">카테고리 그룹별로 뉴스 수집 여부를 켜고 끌 수 있습니다. 비활성화된 그룹은 매일 수집 작업에서 제외됩니다.</div>
        <div id="collect-groups-wrap" style="display:flex;flex-direction:column;gap:10px;margin-bottom:8px;">
          <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;">
            <label class="switch">
              <input type="checkbox" data-group="부동산" class="cg-toggle">
              <span class="slider"></span>
            </label>
            <label style="margin:0;">🏢 부동산 (분양·청약·정책·건설)</label>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;">
            <label class="switch">
              <input type="checkbox" data-group="도시정비" class="cg-toggle">
              <span class="slider"></span>
            </label>
            <label style="margin:0;">🏗️ 도시정비 (재건축·도시정비)</label>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;">
            <label class="switch">
              <input type="checkbox" data-group="광고/매체" class="cg-toggle">
              <span class="slider"></span>
            </label>
            <label style="margin:0;">📺 광고/매체 (옥외광고·디지털광고·산업·미디어·규제) <span style="color:#9b59b6;font-weight:700;">NEW</span></label>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;">
            <label class="switch">
              <input type="checkbox" data-group="AI" class="cg-toggle">
              <span class="slider"></span>
            </label>
            <label style="margin:0;">🤖 AI</label>
          </div>
        </div>
        <div style="text-align:right;margin-bottom:14px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="saveCollectGroups()">카테고리 활성화 저장</button>
          <span id="collect-groups-msg" style="font-size:12px;color:#27ae60;margin-left:10px;"></span>
        </div>

        <h3 style="margin:24px 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">사이트 / 발송</h3>
        <div class="form-group"><label>사이트 URL</label><input name="site_url" placeholder="https://..."></div>
        <div class="form-group"><label>발송 시각 (KST, 0-23) <span style="font-size:11px;color:#95a5a6;">(레거시 - 자동 실행은 위 HH:MM 사용)</span></label><input name="send_hour_kst" type="number" min="0" max="23"></div>
        <div class="form-group">
          <label>회사 로고</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input name="company_logo_url" id="logo-url-input" placeholder="이미지 URL">
            <input type="file" id="logo-file" accept="image/*" style="display:none;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('logo-file').click()">📁 업로드</button>
          </div>
          <div id="logo-preview" style="margin-top:10px;"></div>
        </div>

        <h3 style="margin:24px 0 14px;border-bottom:2px solid #ecf0f1;padding-bottom:6px;">관리자 비밀번호 변경</h3>
        <div class="form-group">
          <label>새 비밀번호 (변경 시에만 입력)</label>
          <input id="new-password" type="password" placeholder="4자 이상">
        </div>

        <div style="text-align:right;margin-top:20px;">
          <button type="submit" class="btn">설정 저장</button>
        </div>
      </form>
    </div>
  `, '환경 설정')
}

// === 위클리 이벤트 캘린더 관리 페이지 ===
// 관리자가 직접 "이번 주 일정" / "다음 주 일정"을 추가/수정/삭제
// 이벤트 타입 8종: 청약 / 견본주택 / 입찰 / 정책 / 금리 / 공급 / 발표 / 기타
export function renderWeeklyEventsPage(): string {
  return adminLayout('weekly-events', `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <div>
        <h1 style="margin:0;">📅 위클리 캘린더</h1>
        <div style="font-size:13px;color:#7f8c8d;margin-top:4px;">
          이번 호에 노출할 <strong>이번 주 일정</strong>·<strong>다음 주 일정</strong>을 관리합니다.
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:13px;color:#5a6c7d;">대상 호 (월요일):</label>
        <input id="we-week-input" type="date" class="input" style="width:160px;" />
        <button class="btn btn-sm btn-secondary" onclick="weeklyEvents.loadList()">조회</button>
        <button class="btn btn-sm" onclick="weeklyEvents.openCreate()">+ 새 일정 추가</button>
      </div>
    </div>

    <div id="we-meta" class="card" style="margin-bottom:14px;font-size:13px;color:#5a6c7d;">로딩 중...</div>

    <div class="card">
      <h3 class="card-title" style="font-size:16px;">📌 이번 주 일정 (this_week)</h3>
      <div id="we-list-this-week" class="we-list">
        <div class="we-empty">로딩 중...</div>
      </div>
    </div>

    <div class="card" style="margin-top:14px;">
      <h3 class="card-title" style="font-size:16px;">🗓️ 다음 주 일정 (next_week)</h3>
      <div id="we-list-next-week" class="we-list">
        <div class="we-empty">로딩 중...</div>
      </div>
    </div>

    <!-- 편집 모달 -->
    <div id="we-modal" class="we-modal" style="display:none;">
      <div class="we-modal-dialog">
        <div class="we-modal-head">
          <h3 id="we-modal-title" style="margin:0;font-size:18px;">새 일정 추가</h3>
          <button class="we-modal-close" onclick="weeklyEvents.closeModal()" aria-label="닫기">✕</button>
        </div>
        <form id="we-form" onsubmit="weeklyEvents.submitForm(event);return false;">
          <input type="hidden" id="we-id" />
          <input type="hidden" id="we-week-start" />

          <div class="we-row">
            <div class="we-col">
              <label>섹션 *</label>
              <select id="we-section" required>
                <option value="this_week">📌 이번 주 일정</option>
                <option value="next_week">🗓️ 다음 주 일정</option>
              </select>
            </div>
            <div class="we-col">
              <label>이벤트 유형 *</label>
              <select id="we-event-type" required>
                <option value="subscription">📝 청약</option>
                <option value="modelhouse">🏠 견본주택</option>
                <option value="bid">📋 입찰</option>
                <option value="policy">📜 정책</option>
                <option value="rate">📊 금리</option>
                <option value="supply">🏗️ 공급</option>
                <option value="announcement">📢 발표</option>
                <option value="other">📌 기타</option>
              </select>
            </div>
          </div>

          <div class="we-row">
            <div class="we-col">
              <label>이벤트 일자 (선택)</label>
              <input type="date" id="we-event-date" />
            </div>
            <div class="we-col">
              <label>카테고리 태그 (선택)</label>
              <input type="text" id="we-category" placeholder="예: 분양, 청약, 정책..." />
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <label>제목 *</label>
            <input type="text" id="we-title" required placeholder="예: 강남 도곡 1차 1순위 청약" />
          </div>

          <div style="margin-bottom:12px;">
            <label>설명 (선택)</label>
            <textarea id="we-description" rows="3" placeholder="이벤트에 대한 간단한 설명"></textarea>
          </div>

          <div style="margin-bottom:14px;">
            <label>정렬 순서 (낮을수록 위)</label>
            <input type="number" id="we-sort-order" value="0" style="width:120px;" />
          </div>

          <div id="we-form-error" class="we-form-error" style="display:none;"></div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
            <button type="button" class="btn btn-secondary" onclick="weeklyEvents.closeModal()">취소</button>
            <button type="submit" class="btn">저장</button>
          </div>
        </form>
      </div>
    </div>

    <script src="/static/admin-weekly-events.js"></script>
  `, '위클리 캘린더')
}

// ════════════════════════════════════════════════════════════════════
// 위클리 이미지 관리 (카테고리 대표 이미지 + 호별 TOP 이미지)
// ════════════════════════════════════════════════════════════════════
export function renderWeeklyImagesPage(): string {
  return adminLayout('weekly-images', `
    <style>
      .wi-section-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
      .wi-card { background:#fff; border:1px solid #e5e9ef; border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:10px; }
      .wi-card h4 { margin:0; font-size:14px; color:#2c3e50; display:flex; align-items:center; gap:6px; }
      .wi-card .wi-desc { font-size:11px; color:#7f8c8d; line-height:1.5; }
      .wi-preview { width:100%; aspect-ratio:16/9; background:#f4f6f8; border:1px dashed #c8d2dc; border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      .wi-preview img { width:100%; height:100%; object-fit:cover; }
      .wi-preview .wi-empty { font-size:12px; color:#95a5a6; }
      .wi-actions { display:flex; gap:6px; flex-wrap:wrap; }
      .wi-actions input[type=file] { font-size:11px; flex:1; min-width:0; }
      .wi-actions .btn { font-size:12px; padding:6px 10px; }
      .wi-meta { font-size:10px; color:#95a5a6; }
      .wi-top-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      @media (max-width:680px){ .wi-top-row { grid-template-columns:1fr; } }
      .wi-toast { position:fixed; top:20px; right:20px; background:#2c3e50; color:#fff; padding:10px 16px; border-radius:8px; font-size:13px; opacity:0; transition:opacity .2s; z-index:1000; max-width:380px; word-break:break-word; }
      .wi-toast.show { opacity:1; }
      .wi-toast.err { background:#e74c3c; }
      .wi-status { font-size:11px; padding:6px 8px; border-radius:6px; line-height:1.5; word-break:break-word; }
      .wi-status.info { background:#eaf3fb; color:#2c5d8f; border:1px solid #c2dcf2; }
      .wi-status.ok   { background:#e6f7ec; color:#1e7e34; border:1px solid #b6e0c2; }
      .wi-status.err  { background:#fdecec; color:#a82828; border:1px solid #f5b8b8; }
      .wi-status.hidden { display:none; }
      .wi-actions .btn[disabled] { opacity:.6; cursor:not-allowed; }
      .wi-progress { height:4px; background:#e5e9ef; border-radius:2px; overflow:hidden; }
      .wi-progress > span { display:block; height:100%; background:#3498db; width:0%; transition:width .15s; }
    </style>

    <h1>🖼️ 위클리 이미지 관리</h1>
    <p style="color:#7f8c8d;font-size:13px;margin-bottom:18px;">카테고리별 대표 이미지(고정)와 호별 TOP 이슈 이미지(주마다)를 직접 업로드/교체할 수 있습니다. R2 스토리지에 저장됩니다.</p>

    <!-- ─── 0) 테스트 메일 보내기 (이미지 적용 확인용) ─── -->
    <div class="card" style="margin-bottom:18px;background:#f8fafd;border:1px solid #cfe2f3;">
      <h3 class="card-title" style="font-size:16px;">✉️ 테스트 메일 보내기 <span style="font-size:11px;font-weight:400;color:#7f8c8d;margin-left:6px;">— 이미지 등록 후 실제 메일에서 어떻게 보이는지 미리 받아보기</span></h3>
      <p style="font-size:12px;color:#7f8c8d;margin:-6px 0 14px;">현재 등록된 카테고리 대표 이미지 / 호별 TOP 이미지가 실제 메일 템플릿에 적용된 모습을 1통 발송으로 확인할 수 있습니다. 멱등성 차단 영향 없습니다.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:13px;color:#2c3e50;font-weight:600;">수신 이메일:</label>
        <input id="wi-test-email" type="email" placeholder="example@motuscompany.co.kr" style="padding:7px 10px;border:1px solid #d8dde5;border-radius:6px;font-size:13px;min-width:260px;">
        <button class="btn" style="background:#3498db;color:#fff;font-size:13px;padding:7px 14px;" onclick="weeklyImages.sendTestDaily()">📧 데일리 메일로 테스트</button>
        <button class="btn" style="background:#2c3e50;color:#fff;font-size:13px;padding:7px 14px;" onclick="weeklyImages.sendTestWeekly()">📨 위클리 메일로 테스트</button>
        <span id="wi-test-status" style="font-size:12px;color:#7f8c8d;"></span>
      </div>
      <div style="font-size:11px;color:#95a5a6;margin-top:8px;">
        ※ 데일리 테스트: 오늘 날짜의 뉴스 + 카테고리 대표 이미지로 발송 (호별 TOP 이미지는 위클리 전용)<br>
        ※ 위클리 테스트: 위에서 선택한 주차의 위클리 요약 + 모든 이미지(섹션 + TOP)로 발송
      </div>
    </div>

    <!-- ─── 1) 카테고리 대표 이미지 (6종) ─── -->
    <div class="card">
      <h3 class="card-title" style="font-size:16px;">📁 카테고리 대표 이미지 (모든 호 공통)</h3>
      <p style="font-size:12px;color:#7f8c8d;margin:-6px 0 14px;">각 카테고리 섹션 상단에 노출됩니다. 한 번 업로드하면 모든 호에 반영됩니다.</p>
      <div id="wi-section-grid" class="wi-section-grid">
        <div style="grid-column:1/-1;text-align:center;color:#95a5a6;padding:24px;">로딩 중...</div>
      </div>
    </div>

    <!-- ─── 2) 호별 TOP 이미지 (slot 1~2) ─── -->
    <div class="card" style="margin-top:18px;">
      <h3 class="card-title" style="font-size:16px;">⭐ 호별 TOP 이미지 (해당 주차만)</h3>
      <p style="font-size:12px;color:#7f8c8d;margin:-6px 0 14px;">매 호별로 강조하고 싶은 TOP 이슈 이미지를 최대 2장까지 등록할 수 있습니다. 본문 TOP3 카드 위에 노출됩니다.</p>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
        <label style="font-size:13px;color:#2c3e50;font-weight:600;">주차(월요일 기준):</label>
        <input id="wi-week" type="date" style="padding:6px 10px;border:1px solid #d8dde5;border-radius:6px;font-size:13px;">
        <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="weeklyImages.loadTop()">조회</button>
        <span id="wi-week-info" style="font-size:11px;color:#7f8c8d;"></span>
      </div>
      <div id="wi-top-row" class="wi-top-row">
        <div class="wi-card" data-slot="1">
          <h4>🥇 슬롯 1 (메인 TOP)</h4>
          <div class="wi-desc">📍 위클리 메일에서 <strong>TOP3 카드 위 메인 배너</strong> 위치에 노출됩니다.</div>
          <div class="wi-preview"><span class="wi-empty">아직 등록되지 않음</span></div>
          <input type="text" class="wi-caption" placeholder="캡션 (선택)" style="padding:6px 8px;border:1px solid #d8dde5;border-radius:6px;font-size:12px;">
          <input type="text" class="wi-link" placeholder="링크 URL (선택, https://)" style="padding:6px 8px;border:1px solid #d8dde5;border-radius:6px;font-size:12px;">
          <div class="wi-actions">
            <input type="file" accept="image/*">
            <button class="btn" data-role="upload" onclick="weeklyImages.uploadTop(1)">업로드</button>
            <button class="btn btn-secondary" data-role="delete" onclick="weeklyImages.deleteTop(1)">삭제</button>
          </div>
          <div class="wi-progress" style="display:none;"><span></span></div>
          <div class="wi-status hidden" data-role="status"></div>
          <div class="wi-meta"></div>
        </div>
        <div class="wi-card" data-slot="2">
          <h4>🥈 슬롯 2 (서브 TOP)</h4>
          <div class="wi-desc">📍 위클리 메일에서 <strong>서브 배너</strong> 위치에 노출됩니다. (슬롯 1 아래)</div>
          <div class="wi-preview"><span class="wi-empty">아직 등록되지 않음</span></div>
          <input type="text" class="wi-caption" placeholder="캡션 (선택)" style="padding:6px 8px;border:1px solid #d8dde5;border-radius:6px;font-size:12px;">
          <input type="text" class="wi-link" placeholder="링크 URL (선택, https://)" style="padding:6px 8px;border:1px solid #d8dde5;border-radius:6px;font-size:12px;">
          <div class="wi-actions">
            <input type="file" accept="image/*">
            <button class="btn" data-role="upload" onclick="weeklyImages.uploadTop(2)">업로드</button>
            <button class="btn btn-secondary" data-role="delete" onclick="weeklyImages.deleteTop(2)">삭제</button>
          </div>
          <div class="wi-progress" style="display:none;"><span></span></div>
          <div class="wi-status hidden" data-role="status"></div>
          <div class="wi-meta"></div>
        </div>
      </div>
    </div>

    <div id="wi-toast" class="wi-toast"></div>

    <script>
    (function(){
      const $ = (s, r=document) => r.querySelector(s)
      const $$ = (s, r=document) => Array.from(r.querySelectorAll(s))

      function toast(msg, isErr=false){
        const t = $('#wi-toast'); t.textContent = msg; t.className = 'wi-toast show' + (isErr?' err':'');
        setTimeout(()=>{ t.className = 'wi-toast'+(isErr?' err':''); }, isErr ? 6000 : 2400)
      }

      // ── 카드별 상태/에러 박스 (toast보다 오래 남는 영구 표시)
      function setCardStatus(card, type, msg){
        const el = card.querySelector('[data-role="status"]')
        if (!el) return
        if (!msg){ el.className = 'wi-status hidden'; el.textContent = ''; return }
        el.className = 'wi-status ' + (type || 'info')
        el.textContent = msg
      }
      function setCardBusy(card, busy){
        card.querySelectorAll('button').forEach(b => { b.disabled = busy })
        const fileInput = card.querySelector('input[type=file]')
        if (fileInput) fileInput.disabled = busy
        const prog = card.querySelector('.wi-progress')
        if (prog){
          prog.style.display = busy ? 'block' : 'none'
          const bar = prog.querySelector('span')
          if (bar) bar.style.width = busy ? '20%' : '0%'
        }
      }
      function setCardProgress(card, pct){
        const bar = card.querySelector('.wi-progress span')
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%'
      }

      function attachFilePreview(card){
        const fileInput = card.querySelector('input[type=file]')
        if (!fileInput) return
        let prevUrl = null
        fileInput.addEventListener('change', function(){
          if (prevUrl){ URL.revokeObjectURL(prevUrl); prevUrl = null }
          const file = fileInput.files[0]
          if (!file || !/^image\\//.test(file.type)) return
          prevUrl = URL.createObjectURL(file)
          const prev = card.querySelector('.wi-preview')
          if (prev) prev.innerHTML = '<img src="' + prevUrl + '" alt="미리보기">'
        })
      }

      // 사람이 읽기 좋은 바이트 표기
      function fmtBytes(n){
        if (n < 1024) return n + ' B'
        if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB'
        return (n/1024/1024).toFixed(2) + ' MB'
      }

      // ── 클라이언트 측 이미지 리사이즈 (Canvas, 최대 1600x900, JPEG 0.85)
      // 큰 파일을 R2/메일 클라이언트가 안전하게 처리할 수 있는 크기로 축소
      async function resizeImageFile(file, opts){
        const maxW = (opts && opts.maxW) || 1600
        const maxH = (opts && opts.maxH) || 1600
        const quality = (opts && opts.quality) || 0.85
        // 이미지 디코드
        const url = URL.createObjectURL(file)
        try {
          const img = await new Promise((resolve, reject) => {
            const im = new Image()
            im.onload = () => resolve(im)
            im.onerror = () => reject(new Error('이미지 디코드 실패 (지원하지 않는 형식이거나 손상된 파일)'))
            im.src = url
          })
          let { width: w, height: h } = img
          const scale = Math.min(1, maxW / w, maxH / h)
          // 이미 작은 경우 + 파일이 1MB 이하면 그대로 사용
          if (scale >= 1 && file.size <= 1024 * 1024) {
            return { file, resized: false, originalSize: file.size, finalSize: file.size, width: w, height: h }
          }
          const nw = Math.round(w * scale)
          const nh = Math.round(h * scale)
          const canvas = document.createElement('canvas')
          canvas.width = nw; canvas.height = nh
          const ctx = canvas.getContext('2d')
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, nw, nh)
          // JPEG로 인코딩 (PNG 알파가 필요하면 PNG 유지)
          const isPng = /png/i.test(file.type)
          const mime = isPng ? 'image/png' : 'image/jpeg'
          const blob = await new Promise(res => canvas.toBlob(res, mime, quality))
          if (!blob) throw new Error('Canvas → Blob 변환 실패')
          const newName = file.name.replace(/\\.[^.]+$/, '') + (isPng ? '.png' : '.jpg')
          const newFile = new File([blob], newName, { type: mime })
          return { file: newFile, resized: true, originalSize: file.size, finalSize: newFile.size, width: nw, height: nh }
        } finally {
          URL.revokeObjectURL(url)
        }
      }

      // ── XHR로 progress 추적하며 multipart 업로드
      function uploadWithProgress(url, formData, onProgress){
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', url, true)
          if (xhr.upload && onProgress){
            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable){
                onProgress((ev.loaded / ev.total) * 100)
              }
            }
          }
          xhr.onload = () => {
            let data = null
            try { data = JSON.parse(xhr.responseText || '{}') } catch(_){}
            if (xhr.status >= 200 && xhr.status < 300){
              resolve({ ok: true, status: xhr.status, data })
            } else {
              resolve({ ok: false, status: xhr.status, data, raw: xhr.responseText })
            }
          }
          xhr.onerror = () => reject(new Error('네트워크 오류 (요청이 서버에 도달하지 못함)'))
          xhr.ontimeout = () => reject(new Error('업로드 타임아웃'))
          xhr.send(formData)
        })
      }

      // ── 업로드 가능 한도 (클라이언트 측 안전선)
      const MAX_UPLOAD_BYTES = 10 * 1024 * 1024   // 10MB (서버와 동일)
      const SOFT_WARN_BYTES   =  5 * 1024 * 1024   // 5MB부터 자동 리사이즈 권장

      // 가장 가까운 월요일 (한국 시간 기준)
      function nearestMonday(d = new Date()){
        const day = d.getDay()
        const diff = (day === 0 ? -6 : 1 - day) // 일요일이면 -6, 그 외 1-day
        const m = new Date(d); m.setDate(m.getDate() + diff)
        return m.toISOString().slice(0,10)
      }

      const weeklyImages = {
        async loadSections(){
          const grid = $('#wi-section-grid')
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#95a5a6;padding:24px;">로딩 중...</div>'
          try {
            const [metaRes, sectionsRes] = await Promise.all([
              fetch('/admin/api/weekly-images/section-meta'),
              fetch('/admin/api/weekly-images/sections'),
            ])
            const meta = (await metaRes.json()).meta || {}
            const data = await sectionsRes.json()
            const sections = data.sections || {}
            const keys = data.manageable_keys || []
            grid.innerHTML = keys.map(k => {
              const m = meta[k] || { label:k, icon:'📁', description:'' }
              const url = sections[k]
              const previewHtml = url
                ? \`<img src="\${url}" alt="\${m.label}">\`
                : '<span class="wi-empty">아직 등록되지 않음</span>'
              return \`
              <div class="wi-card" data-key="\${k}">
                <h4>\${m.icon} \${m.label}</h4>
                <div class="wi-desc">\${m.description||''}</div>
                <div class="wi-preview">\${previewHtml}</div>
                <input type="text" class="wi-alt" placeholder="alt 텍스트 (선택)" style="padding:6px 8px;border:1px solid #d8dde5;border-radius:6px;font-size:12px;">
                <div class="wi-actions">
                  <input type="file" accept="image/*">
                  <button class="btn" data-role="upload" onclick="weeklyImages.uploadSection('\${k}')">업로드</button>
                  <button class="btn btn-secondary" data-role="delete" onclick="weeklyImages.deleteSection('\${k}')">삭제</button>
                </div>
                <div class="wi-progress" style="display:none;"><span></span></div>
                <div class="wi-status hidden" data-role="status"></div>
              </div>\`
            }).join('')
            $$('.wi-card[data-key]', grid).forEach(card => attachFilePreview(card))
          } catch(e){
            grid.innerHTML = '<div style="grid-column:1/-1;color:#e74c3c;padding:24px;">로딩 실패: '+e.message+'</div>'
          }
        },

        async uploadSection(key){
          const card = $('[data-key="'+key+'"]')
          const fileInput = card.querySelector('input[type=file]')
          const altInput = card.querySelector('.wi-alt')
          const file = fileInput.files[0]
          setCardStatus(card, null, '')
          if (!file){
            setCardStatus(card, 'err', '파일을 먼저 선택해 주세요.')
            toast('파일을 선택해 주세요.', true); return
          }
          // 1) MIME 검증
          if (!/^image\\//.test(file.type)){
            setCardStatus(card, 'err', '이미지 파일만 업로드 가능합니다. (현재 형식: ' + (file.type || '알 수 없음') + ')')
            return
          }
          // 2) 크기 사전 검증 — 10MB 초과는 즉시 차단
          if (file.size > MAX_UPLOAD_BYTES){
            setCardStatus(card, 'err',
              '파일이 너무 큽니다: ' + fmtBytes(file.size) +
              ' (최대 ' + fmtBytes(MAX_UPLOAD_BYTES) + '). ' +
              '이미지 편집 도구로 크기를 줄여서 다시 시도해 주세요.')
            return
          }

          setCardBusy(card, true)
          setCardStatus(card, 'info', '준비 중... 큰 이미지는 자동으로 리사이즈됩니다.')

          try {
            // 3) 자동 리사이즈 — 5MB 이상이거나 어떤 경우든 일관된 최대 1600x900으로 축소
            let payloadFile = file
            try {
              const r = await resizeImageFile(file, { maxW: 1600, maxH: 1600, quality: 0.85 })
              payloadFile = r.file
              if (r.resized){
                setCardStatus(card, 'info',
                  '자동 리사이즈: ' + fmtBytes(r.originalSize) + ' → ' + fmtBytes(r.finalSize) +
                  ' (' + r.width + '×' + r.height + '). 업로드 중...')
              } else {
                setCardStatus(card, 'info', '업로드 중... (' + fmtBytes(payloadFile.size) + ')')
              }
            } catch(resizeErr){
              // 리사이즈 실패해도 원본으로 시도
              console.warn('[uploadSection] resize failed, using original:', resizeErr)
              setCardStatus(card, 'info', '리사이즈 생략, 원본 업로드 중... (' + fmtBytes(file.size) + ')')
            }

            const fd = new FormData()
            fd.append('file', payloadFile)
            if (altInput.value.trim()) fd.append('alt_text', altInput.value.trim())

            const res = await uploadWithProgress(
              '/admin/api/weekly-images/sections/'+encodeURIComponent(key),
              fd,
              (pct) => setCardProgress(card, pct)
            )

            if (!res.ok){
              const errMsg = (res.data && (res.data.error || res.data.message)) || ('HTTP ' + res.status)
              const detail = (res.data && res.data.detail) ? ' — ' + res.data.detail : ''
              throw new Error(errMsg + detail)
            }
            setCardStatus(card, 'ok', '✓ 업로드 완료 (' + fmtBytes(payloadFile.size) + ')')
            toast('✓ 업로드 완료: ' + key)
            await this.loadSections()
          } catch(e){
            const msg = (e && e.message) || String(e)
            setCardStatus(card, 'err', '업로드 실패: ' + msg)
            toast('실패 (' + key + '): ' + msg, true)
            console.error('[uploadSection] error', key, e)
          } finally {
            setCardBusy(card, false)
          }
        },

        async deleteSection(key){
          if (!confirm(key+' 대표 이미지를 삭제하시겠습니까?')) return
          try {
            const r = await fetch('/admin/api/weekly-images/sections/'+encodeURIComponent(key), { method:'DELETE' })
            const j = await r.json()
            if (!r.ok) throw new Error(j.error || '삭제 실패')
            toast('✓ 삭제 완료')
            this.loadSections()
          } catch(e){ toast('실패: '+e.message, true) }
        },

        async loadTop(){
          const week = $('#wi-week').value
          if (!week){ toast('주차를 선택해 주세요.', true); return }
          $('#wi-week-info').textContent = ''
          try {
            const r = await fetch('/admin/api/weekly-images/top?week_start_date='+encodeURIComponent(week))
            const j = await r.json()
            if (!r.ok) throw new Error(j.error || '조회 실패')
            const slots = j.slots || { '1':null, '2':null }
            ;[1,2].forEach(s => {
              const card = $('[data-slot="'+s+'"]')
              const row = slots[String(s)]
              const prev = card.querySelector('.wi-preview')
              const cap = card.querySelector('.wi-caption')
              const link = card.querySelector('.wi-link')
              const meta = card.querySelector('.wi-meta')
              if (row){
                prev.innerHTML = '<img src="'+row.image_url+'" alt="slot '+s+'">'
                cap.value = row.caption || ''
                link.value = row.link_url || ''
                meta.textContent = '등록일: ' + (row.created_at || '-')
              } else {
                prev.innerHTML = '<span class="wi-empty">아직 등록되지 않음</span>'
                cap.value = ''; link.value = ''; meta.textContent = ''
              }
            })
            $('#wi-week-info').textContent = '✓ '+week+' 조회 완료'
          } catch(e){ toast('실패: '+e.message, true) }
        },

        async uploadTop(slot){
          const week = $('#wi-week').value
          const card = $('[data-slot="'+slot+'"]')
          setCardStatus(card, null, '')
          if (!week){
            setCardStatus(card, 'err', '먼저 상단에서 주차를 선택하고 [조회]를 누른 뒤 업로드해 주세요.')
            toast('주차를 먼저 선택해 주세요.', true); return
          }
          const fileInput = card.querySelector('input[type=file]')
          const file = fileInput.files[0]
          const caption = card.querySelector('.wi-caption').value.trim()
          const linkUrl = card.querySelector('.wi-link').value.trim()
          if (!file){
            setCardStatus(card, 'err', '파일을 먼저 선택해 주세요.')
            toast('파일을 선택해 주세요.', true); return
          }
          if (!/^image\\//.test(file.type)){
            setCardStatus(card, 'err', '이미지 파일만 업로드 가능합니다. (현재 형식: ' + (file.type || '알 수 없음') + ')')
            return
          }
          if (file.size > MAX_UPLOAD_BYTES){
            setCardStatus(card, 'err',
              '파일이 너무 큽니다: ' + fmtBytes(file.size) +
              ' (최대 ' + fmtBytes(MAX_UPLOAD_BYTES) + ').')
            return
          }

          setCardBusy(card, true)
          setCardStatus(card, 'info', '준비 중...')

          try {
            let payloadFile = file
            try {
              const r = await resizeImageFile(file, { maxW: 1600, maxH: 1600, quality: 0.85 })
              payloadFile = r.file
              if (r.resized){
                setCardStatus(card, 'info',
                  '자동 리사이즈: ' + fmtBytes(r.originalSize) + ' → ' + fmtBytes(r.finalSize) +
                  ' (' + r.width + '×' + r.height + '). 업로드 중...')
              } else {
                setCardStatus(card, 'info', '업로드 중... (' + fmtBytes(payloadFile.size) + ')')
              }
            } catch(resizeErr){
              console.warn('[uploadTop] resize failed, using original:', resizeErr)
              setCardStatus(card, 'info', '리사이즈 생략, 원본 업로드 중... (' + fmtBytes(file.size) + ')')
            }

            const fd = new FormData()
            fd.append('file', payloadFile)
            fd.append('week_start_date', week)
            fd.append('slot', String(slot))
            if (caption) fd.append('caption', caption)
            if (linkUrl) fd.append('link_url', linkUrl)

            const res = await uploadWithProgress(
              '/admin/api/weekly-images/top',
              fd,
              (pct) => setCardProgress(card, pct)
            )

            if (!res.ok){
              const errMsg = (res.data && (res.data.error || res.data.message)) || ('HTTP ' + res.status)
              const detail = (res.data && res.data.detail) ? ' — ' + res.data.detail : ''
              throw new Error(errMsg + detail)
            }
            setCardStatus(card, 'ok', '✓ 슬롯 ' + slot + ' 업로드 완료 (' + fmtBytes(payloadFile.size) + ')')
            toast('✓ 슬롯 '+slot+' 업로드 완료')
            await this.loadTop()
          } catch(e){
            const msg = (e && e.message) || String(e)
            setCardStatus(card, 'err', '업로드 실패: ' + msg)
            toast('실패 (슬롯 '+slot+'): '+msg, true)
            console.error('[uploadTop] error', slot, e)
          } finally {
            setCardBusy(card, false)
          }
        },

        async deleteTop(slot){
          const week = $('#wi-week').value
          if (!week){ toast('주차를 선택해 주세요.', true); return }
          if (!confirm(week+' 슬롯 '+slot+' 이미지를 삭제하시겠습니까?')) return
          try {
            const r = await fetch('/admin/api/weekly-images/top?week_start_date='+encodeURIComponent(week)+'&slot='+slot, { method:'DELETE' })
            const j = await r.json()
            if (!r.ok) throw new Error(j.error || '삭제 실패')
            toast('✓ 삭제 완료')
            this.loadTop()
          } catch(e){ toast('실패: '+e.message, true) }
        },

        // ── 테스트 메일 발송 (데일리)
        async sendTestDaily(){
          const to = ($('#wi-test-email').value || '').trim()
          if (!to || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(to)){
            toast('올바른 이메일을 입력해 주세요.', true); return
          }
          const statusEl = $('#wi-test-status')
          statusEl.textContent = '📤 데일리 테스트 발송 중...'
          statusEl.style.color = '#7f8c8d'
          try {
            const r = await fetch('/admin/api/test-send-daily', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ to })
            })
            const j = await r.json()
            if (!j.success) throw new Error(j.error || '발송 실패')
            statusEl.textContent = '✅ 발송 성공! (수신함 확인 — 카테고리 이미지 ' + (j.sectionImagesApplied||0) + '장 적용, 뉴스 ' + (j.newsCount||0) + '건)'
            statusEl.style.color = '#27ae60'
            toast('✓ 데일리 테스트 메일 발송 완료')
          } catch(e){
            statusEl.textContent = '❌ 실패: ' + e.message
            statusEl.style.color = '#e74c3c'
            toast('실패: '+e.message, true)
          }
        },

        // ── 테스트 메일 발송 (위클리)
        async sendTestWeekly(){
          const to = ($('#wi-test-email').value || '').trim()
          if (!to || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(to)){
            toast('올바른 이메일을 입력해 주세요.', true); return
          }
          const week = $('#wi-week').value  // 위에서 선택한 주차 사용 (미지정 시 서버가 최신 자동 선택)
          const statusEl = $('#wi-test-status')
          statusEl.textContent = '📤 위클리 테스트 발송 중...'
          statusEl.style.color = '#7f8c8d'
          try {
            const body = { to }
            if (week) body.week_start_date = week
            const r = await fetch('/admin/api/test-send-weekly', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify(body)
            })
            const j = await r.json()
            if (!j.success) throw new Error(j.error || '발송 실패')
            statusEl.textContent = '✅ 발송 성공! (수신함 확인 — VOL.' + (j.volNo||0) + ', 섹션 이미지 ' + (j.sectionImagesApplied||0) + '장, TOP 이미지 ' + (j.topImagesApplied||0) + '장 적용)'
            statusEl.style.color = '#27ae60'
            toast('✓ 위클리 테스트 메일 발송 완료')
          } catch(e){
            statusEl.textContent = '❌ 실패: ' + e.message
            statusEl.style.color = '#e74c3c'
            toast('실패: '+e.message, true)
          }
        },
      }
      window.weeklyImages = weeklyImages

      // 초기화
      $('#wi-week').value = nearestMonday()
      $$('[data-slot]').forEach(card => attachFilePreview(card))
      weeklyImages.loadSections()
      weeklyImages.loadTop()
    })();
    </script>
  `, '위클리 이미지')
}

// ════════════════════════════════════════════════════════════════════
// 운영자 검수 — 맞춤형 위클리 본문 시각 확인 + 승인/보류
// ════════════════════════════════════════════════════════════════════
export function renderPersonalizedReviewPage(): string {
  return adminLayout('personalized-review', `
    <style>
      .pr-layout { display:grid; grid-template-columns:340px 1fr; gap:16px; min-height:calc(100vh - 140px); }
      @media (max-width:1024px){ .pr-layout { grid-template-columns:1fr; } }
      .pr-list { background:#fff; border:1px solid #e5e9ef; border-radius:10px; padding:14px; overflow-y:auto; max-height:calc(100vh - 140px); }
      .pr-list h3 { margin:0 0 10px; font-size:14px; color:#2c3e50; }
      .pr-item { padding:10px 12px; border:1px solid #e5e9ef; border-radius:8px; cursor:pointer; margin-bottom:8px; transition:.15s; }
      .pr-item:hover { background:#f4f6f8; border-color:#3498db; }
      .pr-item.active { background:#eaf3fb; border-color:#3498db; }
      .pr-item .pr-title { font-size:13px; font-weight:600; color:#2c3e50; }
      .pr-item .pr-sub { font-size:11px; color:#7f8c8d; margin-top:3px; line-height:1.5; }
      .pr-empty { color:#95a5a6; font-size:12px; padding:18px; text-align:center; }
      .pr-detail { background:#fff; border:1px solid #e5e9ef; border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:12px; }
      .pr-detail-header { display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid #e5e9ef; }
      .pr-detail-meta { font-size:12px; color:#5a6878; line-height:1.6; }
      .pr-actions { display:flex; gap:8px; flex-wrap:wrap; }
      .pr-actions .btn { font-size:13px; padding:8px 14px; }
      .pr-iframe-wrap { border:1px solid #d8dde5; border-radius:8px; overflow:hidden; background:#f4f6f8; min-height:560px; }
      .pr-iframe-wrap iframe { width:100%; height:760px; border:0; display:block; background:#fff; }
      .pr-verify-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:8px; }
      .pr-verify-pill { background:#f4f6f8; border:1px solid #e5e9ef; border-radius:6px; padding:8px 10px; font-size:11px; }
      .pr-verify-pill .lbl { color:#7f8c8d; font-size:10px; display:block; margin-bottom:2px; }
      .pr-verify-pill .val { color:#2c3e50; font-weight:600; font-size:13px; }
      .pr-verify-pill.ok .val { color:#27ae60; }
      .pr-verify-pill.bad .val { color:#e74c3c; }
      .pr-status-badge { display:inline-block; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; }
      .pr-status-ready { background:#fef5e7; color:#d68910; }
      .pr-status-approved { background:#d5f5e3; color:#229954; }
      .pr-status-held { background:#fadbd8; color:#c0392b; }
      .pr-toast { position:fixed; top:20px; right:20px; background:#2c3e50; color:#fff; padding:10px 16px; border-radius:8px; font-size:13px; opacity:0; transition:opacity .2s; z-index:1000; }
      .pr-toast.show { opacity:1; }
      .pr-toast.err { background:#e74c3c; }
      .pr-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:6px; }
      .pr-toolbar input, .pr-toolbar select { padding:6px 10px; border:1px solid #d8dde5; border-radius:6px; font-size:12px; }
    </style>

    <h1>✅ 맞춤형 위클리 운영자 검수</h1>
    <p style="color:#7f8c8d;font-size:13px;margin-bottom:14px;">자동 검증을 통과한 본문(<code>status='ready'</code>)을 실제 메일 형식으로 미리보고 승인/보류할 수 있습니다.</p>

    <div class="pr-toolbar">
      <span style="font-size:12px;color:#5a6878;">주차 조회:</span>
      <input id="pr-week" type="date">
      <input id="pr-profile" placeholder="company_profile (예: gs)" style="width:200px;">
      <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="prReview.manualLoad()">미리보기</button>
      <span style="margin-left:auto;font-size:11px;color:#95a5a6;">자동으로는 status='ready'인 호만 좌측 목록에 나타납니다.</span>
    </div>

    <div class="pr-layout">
      <!-- 좌측: 대기 목록 -->
      <aside class="pr-list">
        <h3>📋 검수 대기 (status='ready')</h3>
        <div id="pr-list-body">
          <div class="pr-empty">로딩 중...</div>
        </div>
      </aside>

      <!-- 우측: 디테일 + 미리보기 + 액션 -->
      <section class="pr-detail">
        <div id="pr-detail-body">
          <div class="pr-empty" style="padding:40px;">좌측에서 항목을 선택하거나 상단에서 주차+프로필을 입력해 주세요.</div>
        </div>
      </section>
    </div>

    <div id="pr-toast" class="pr-toast"></div>

    <script>
    (function(){
      const $ = s => document.querySelector(s)
      function toast(msg, err=false){
        const t = $('#pr-toast'); t.textContent = msg; t.className='pr-toast show'+(err?' err':'');
        setTimeout(()=>{ t.className='pr-toast'+(err?' err':''); }, 2600)
      }
      function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\'':'&#39;'}[m])) }
      function nearestMonday(d=new Date()){ const day=d.getDay(); const diff=(day===0?-6:1-day); const m=new Date(d); m.setDate(m.getDate()+diff); return m.toISOString().slice(0,10) }

      let pendingItems = []
      let current = null // { week, profile }

      async function loadPending(){
        const body = $('#pr-list-body')
        body.innerHTML = '<div class="pr-empty">로딩 중...</div>'
        try {
          const r = await fetch('/admin/api/personalized-weekly/pending-reviews')
          const j = await r.json()
          pendingItems = j.items || []
          if (!pendingItems.length){
            body.innerHTML = '<div class="pr-empty">검수 대기 중인 호가 없습니다.</div>'
            return
          }
          body.innerHTML = pendingItems.map((it,idx) => \`
            <div class="pr-item" data-idx="\${idx}" onclick="prReview.select(\${idx})">
              <div class="pr-title">\${escapeHtml(it.company_profile)} · \${escapeHtml(it.week_start_date)}</div>
              <div class="pr-sub">vol.\${it.vol_no||'-'} / 기사 \${it.article_count||0}건<br>\${escapeHtml((it.market_oneliner||'').slice(0,60))}</div>
            </div>\`).join('')
        } catch(e){
          body.innerHTML = '<div class="pr-empty">로딩 실패: '+escapeHtml(e.message)+'</div>'
        }
      }

      function renderVerification(v){
        if (!v || typeof v !== 'object') return '<div class="pr-empty" style="padding:10px;">자동 검증 정보 없음</div>'
        const items = []
        const push = (lbl, val, cls='') => items.push(\`<div class="pr-verify-pill \${cls}"><span class="lbl">\${lbl}</span><span class="val">\${val}</span></div>\`)
        if ('passed' in v) push('자동 검증', v.passed?'PASS':'FAIL', v.passed?'ok':'bad')
        if ('score' in v) push('점수', v.score)
        if ('article_count' in v) push('기사 수', v.article_count)
        if (Array.isArray(v.issues) && v.issues.length){
          push('이슈 개수', v.issues.length, 'bad')
        }
        const html = '<div class="pr-verify-grid">'+items.join('')+'</div>'
        const issueList = (Array.isArray(v.issues) && v.issues.length)
          ? '<details style="margin-top:8px;"><summary style="font-size:12px;color:#c0392b;cursor:pointer;">⚠ 검증 이슈 '+v.issues.length+'건 펼치기</summary><ul style="margin:6px 0 0 18px;font-size:11px;color:#5a6878;">'+v.issues.map(i=>'<li>'+escapeHtml(typeof i==='string'?i:JSON.stringify(i))+'</li>').join('')+'</ul></details>'
          : ''
        return html + issueList
      }

      async function renderDetail(week, profile){
        current = { week, profile }
        const body = $('#pr-detail-body')
        body.innerHTML = '<div class="pr-empty" style="padding:18px;">로딩 중...</div>'
        try {
          const dRes = await fetch('/admin/api/personalized-weekly/review-detail?week_start_date='+encodeURIComponent(week)+'&company_profile='+encodeURIComponent(profile))
          const d = await dRes.json()
          if (!dRes.ok){ throw new Error(d.error || '조회 실패') }
          const previewUrl = '/admin/api/personalized-weekly/preview?week_start_date='+encodeURIComponent(week)+'&company_profile='+encodeURIComponent(profile)
          const statusBadge = '<span class="pr-status-badge pr-status-'+escapeHtml(d.status||'ready')+'">'+escapeHtml(d.status||'ready')+'</span>'
          const opBadge = d.operator_review_status ? ' · 운영자: <span class="pr-status-badge pr-status-'+escapeHtml(d.operator_review_status)+'">'+escapeHtml(d.operator_review_status)+'</span>' : ''
          body.innerHTML = \`
            <div class="pr-detail-header">
              <div>
                <div style="font-size:18px;font-weight:700;color:#2c3e50;">\${escapeHtml(d.profile_name||d.company_profile)} · \${escapeHtml(d.week_start_date)}</div>
                <div class="pr-detail-meta">
                  \${statusBadge}\${opBadge}
                  · 기사 \${d.article_count||0}건 · 본문 \${d.content_length||0}자
                  · 발행일 \${escapeHtml(d.issue_date||'-')}
                </div>
              </div>
              <div class="pr-actions">
                <a class="btn btn-secondary" href="\${previewUrl}" target="_blank" style="text-decoration:none;">🔗 새 창에서 열기</a>
                <button class="btn" style="background:#27ae60;color:#fff;" onclick="prReview.act('approved')">✓ 승인</button>
                <button class="btn" style="background:#e67e22;color:#fff;" onclick="prReview.act('pending')">⏸ 보류</button>
                <button class="btn" style="background:#e74c3c;color:#fff;" onclick="prReview.act('rejected')">✗ 반려</button>
              </div>
            </div>
            <div>
              <div style="font-size:13px;color:#2c3e50;font-weight:600;margin-bottom:4px;">📊 자동 검증 결과</div>
              \${renderVerification(d.verification)}
            </div>
            \${d.operator_review_notes ? '<div style="font-size:12px;background:#fff8e1;border:1px solid #ffe082;padding:10px;border-radius:6px;color:#5a6878;">📝 기존 운영자 메모: '+escapeHtml(d.operator_review_notes)+'</div>' : ''}
            <div style="font-size:13px;color:#2c3e50;font-weight:600;">📧 메일 미리보기 (실제 발송 본문)</div>
            <div class="pr-iframe-wrap">
              <iframe src="\${previewUrl}" sandbox="allow-same-origin"></iframe>
            </div>
          \`
        } catch(e){
          body.innerHTML = '<div class="pr-empty" style="padding:24px;color:#e74c3c;">로딩 실패: '+escapeHtml(e.message)+'</div>'
        }
      }

      const prReview = {
        select(idx){
          const it = pendingItems[idx]; if (!it) return
          document.querySelectorAll('.pr-item').forEach(el => el.classList.remove('active'))
          const el = document.querySelector('.pr-item[data-idx="'+idx+'"]'); if (el) el.classList.add('active')
          $('#pr-week').value = it.week_start_date
          $('#pr-profile').value = it.company_profile
          renderDetail(it.week_start_date, it.company_profile)
        },
        manualLoad(){
          const w = $('#pr-week').value, p = $('#pr-profile').value.trim()
          if (!w || !p){ toast('주차와 company_profile을 입력해 주세요.', true); return }
          renderDetail(w, p)
        },
        async act(status){
          if (!current){ toast('대상이 선택되지 않았습니다.', true); return }
          let notes = null
          if (status !== 'approved'){
            notes = prompt((status==='pending'?'보류':'반려')+' 사유 (선택):', '') || null
          }
          try {
            const r = await fetch('/admin/api/personalized-weekly/review', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ week_start_date: current.week, company_profile: current.profile, status, notes }),
            })
            const j = await r.json()
            if (!r.ok) throw new Error(j.error || '처리 실패')
            toast('✓ '+status+' 처리 완료 (status='+(j.new_row_status||'-')+')')
            await loadPending()
            await renderDetail(current.week, current.profile)
          } catch(e){ toast('실패: '+e.message, true) }
        },
      }
      window.prReview = prReview

      // 초기화
      $('#pr-week').value = nearestMonday()
      loadPending()
    })();
    </script>
  `, '운영자 검수')
}

