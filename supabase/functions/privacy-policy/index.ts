const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] || char));

// Encode every non-ASCII character as an HTML numeric reference. This keeps Korean
// text readable even in clients that incorrectly ignore the response charset.
const encodeNonAscii = (value: string) =>
  Array.from(value, (char) => {
    const code = char.codePointAt(0)!;
    return code > 0x7f ? `&#${code};` : char;
  }).join("");

Deno.serve((req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const operator = "이동규";
  const contactRaw = (Deno.env.get("ACCOUNT_DELETION_CONTACT_EMAIL") || "dlehdrb554@gmail.com").trim();
  const contact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactRaw) ? contactRaw : "";
  const region = htmlEscape(Deno.env.get("PRIVACY_POLICY_DATA_REGION") || "Northeast Asia (Seoul)");
  const contactHtml = contact
    ? `<a href="mailto:${htmlEscape(contact)}">${htmlEscape(contact)}</a>`
    : "<strong>개인정보 문의 이메일을 확인할 수 없습니다.</strong>";

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Balletmate 개인정보 처리방침</title>
  <style>
    :root{color-scheme:light}*{box-sizing:border-box}
    body{margin:0;background:#f7f6fa;color:#292536;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.75;word-break:keep-all}
    main{max-width:900px;margin:0 auto;padding:34px 20px 64px}
    header,.panel{background:#fff;border:1px solid #e9e5f0;border-radius:18px;padding:24px;margin-bottom:16px}
    header{border-top:5px solid #7661d8}
    h1{font-size:27px;line-height:1.35;margin:0 0 12px}
    h2{font-size:19px;margin:30px 0 12px;padding-bottom:8px;border-bottom:1px solid #eeeaf4}
    h3{font-size:15px;margin:20px 0 8px}
    p{margin:8px 0}ul,ol{padding-left:22px}li{margin:5px 0}
    .meta{color:#6e687b;font-size:13px}.lead{font-size:14px;color:#5d5869}
    .table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:620px;font-size:13px}
    th,td{border:1px solid #e9e5f0;padding:10px;text-align:left;vertical-align:top}
    th{background:#f5f2fb;font-weight:700}
    a{color:#5d43bd;overflow-wrap:anywhere}.small{font-size:12px;color:#777184}
    .pill{display:inline-block;background:#f1edff;color:#5d43bd;border-radius:99px;padding:3px 9px;font-size:12px;font-weight:700}
    footer{font-size:12px;color:#777184;text-align:center;padding:18px}
    @media(max-width:600px){main{padding:16px 12px 40px}header,.panel{padding:18px;border-radius:14px}h1{font-size:23px}h2{font-size:18px}}
  </style>
</head>
<body>
<main>
  <header>
    <span class="pill">Balletmate</span>
    <h1>개인정보 처리방침</h1>
    <p class="lead">발레메이트는 이용자의 개인정보를 소중하게 보호하며, 개인정보 보호법 등 관계 법령을 준수합니다. 이 처리방침은 발레메이트 앱에서 어떤 정보를 어떤 목적으로 처리하는지 안내합니다.</p>
    <p class="meta">시행일: 2026년 11월 25일 · 개인정보처리자: ${operator}</p>
  </header>

  <section class="panel">
    <h2>1. 개인정보 처리 목적 및 원칙</h2>
    <p>발레메이트는 다음 목적을 위해 필요한 최소한의 개인정보를 처리합니다.</p>
    <ul>
      <li>회원 가입, 로그인, 회원 식별 및 계정 관리</li>
      <li>학원 검색, 즐겨찾기 저장 및 이용자 설정 동기화</li>
      <li>학원 리뷰·커뮤니티 운영, 게시물 신고 및 부정 이용 방지</li>
      <li>학원 운영자 확인, 학원 정보·공지·가격표·시간표 관리</li>
      <li>공지 및 이용자가 선택한 알림의 발송</li>
      <li>문의 응대, 서비스 안정성 확보 및 보안 사고 대응</li>
    </ul>
    <p>발레메이트는 개인정보를 위 목적 외로 이용하지 않습니다. 목적이나 처리 항목이 변경되는 경우 관련 법령에 따라 처리방침을 변경하고 앱 또는 본 페이지를 통해 안내합니다.</p>
  </section>

  <section class="panel">
    <h2>2. 처리하는 개인정보 항목과 수집 방법</h2>
    <p>회원이 직접 입력하거나 소셜 로그인·앱 기능 이용 과정에서 다음 정보가 처리될 수 있습니다.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>구분</th><th>처리 항목</th><th>처리 목적</th><th>처리 근거</th><th>보유 기준</th></tr></thead>
      <tbody>
        <tr><td>회원 계정</td><td>이메일 주소, 내부 회원 식별자, 아이디, 닉네임·표시명, 로그인 제공자 및 제공자가 전달하는 계정 식별정보(제공되는 경우)</td><td>가입, 로그인, 회원 식별, 계정 관리</td><td>서비스 이용계약 이행(개인정보 보호법 제15조 제1항 제4호)</td><td>회원 탈퇴 시까지</td></tr>
        <tr><td>프로필·설정</td><td>아이디, 닉네임·표시명, 선택적으로 인증된 전화번호(등록된 경우), 즐겨찾기 학원 식별자 및 스냅샷, 알림 설정</td><td>프로필 표시, 즐겨찾기 동기화, 개인 설정 제공</td><td>서비스 이용계약 이행(제15조 제1항 제4호)</td><td>회원 탈퇴 또는 정보 삭제 시까지</td></tr>
        <tr><td>커뮤니티·리뷰</td><td>게시글·댓글·리뷰 내용, 평점, 작성자 표시명, 게시글 북마크, 신고 내용, 차단 관계, 커뮤니티 이용규칙 동의 기록</td><td>게시·소통, 리뷰 제공, 신고 처리, 운영 및 어뷰징 방지</td><td>서비스 이용계약 이행(제15조 제1항 제4호)</td><td>회원 탈퇴 또는 게시물 삭제 시까지</td></tr>
        <tr><td>학원 관리 신청</td><td>대상 학원, 신청 상태, 사업자등록번호, 사업자·대표자명, 사업장 주소, 증빙서류 파일, 확인용 URL·코드 및 신청 처리 이력</td><td>학원 관리자 권한 확인 및 학원 정보 관리</td><td>서비스 이용계약 이행(제15조 제1항 제4호)</td><td>신청 처리 및 관리자 권한 유지 기간</td></tr>
        <tr><td>학원 자료</td><td>학원 운영자가 등록한 공개 가격표·시간표 이미지와 내용, 학원 공지 및 게시 이력</td><td>학원 정보 제공 및 학원 관리</td><td>서비스 이용계약 이행(제15조 제1항 제4호)</td><td>공개 또는 관리 목적 달성 시까지</td></tr>
        <tr><td>위치 기반 검색</td><td>이용자가 위치 권한을 허용하고 주변 검색을 실행할 때의 위도·경도, 검색어 및 검색 반경</td><td>주변 발레학원 검색</td><td>이용자 동의(제15조 제1항 제1호) 및 기능 실행 요청</td><td>검색 요청 처리에 이용하며 앱 데이터베이스에 현재 위치를 별도 저장하지 않음</td></tr>
        <tr><td>푸시 알림</td><td>Expo 푸시 토큰, 기기 운영체제 구분(iOS·Android 등), 알림 수신 설정</td><td>공지 및 이용자가 설정한 학원 업데이트 알림 발송</td><td>이용자 동의 및 알림 권한 허용(제15조 제1항 제1호)</td><td>회원 탈퇴 또는 토큰 무효 확인 시까지</td></tr>
        <tr><td>자동 생성 정보</td><td>서비스 접속 시각, IP 주소, 앱·운영체제 정보, 오류 및 보안 관련 로그(서비스 제공 인프라가 생성하는 범위)</td><td>서비스 운영, 장애 분석, 보안 및 부정 이용 방지</td><td>서비스 제공 및 안전한 운영에 필요한 범위(제15조 제1항 제4호 등)</td><td>각 인프라 제공자의 로그 보관 정책 및 관계 법령에 따름</td></tr>
      </tbody>
    </table></div>
    <h3>수집 방법</h3>
    <ul>
      <li>이메일 회원가입 및 로그인 과정에서 이용자가 입력하는 정보</li>
      <li>이용자가 선택한 Google 또는 Kakao 소셜 로그인 과정에서 제공되는 정보</li>
      <li>즐겨찾기, 리뷰, 커뮤니티, 학원 관리 및 알림 기능 이용 과정에서 이용자가 입력·업로드하는 정보</li>
      <li>위치 권한을 허용한 상태에서 주변 학원 검색 기능을 실행할 때 기기에서 전달되는 위치 정보</li>
    </ul>
    <p class="small">발레메이트는 회원가입 화면에서 주민등록번호, 결제카드 정보 또는 건강정보를 요구하지 않습니다. 게시글이나 문의 내용에 민감정보를 직접 입력하지 않도록 주의해 주세요.</p>
  </section>

  <section class="panel">
    <h2>3. 개인정보의 보유 및 이용 기간</h2>
    <ul>
      <li><strong>회원 계정 및 회원별 정보:</strong> 회원 탈퇴 시까지 보유하며, 탈퇴 처리 시 계정과 연결된 프로필, 즐겨찾기, 알림 설정, 리뷰·커뮤니티 활동 및 신청 정보는 운영 데이터베이스와 저장소에서 삭제합니다.</li>
      <li><strong>학원 자체의 공개 정보:</strong> 학원명, 주소, 공개된 학원 사진·가격표·시간표 등 학원 자체에 관한 정보는 회원 계정과 분리되어 있으므로 해당 회원이 탈퇴하더라도 학원 정보로 계속 제공될 수 있습니다.</li>
      <li><strong>학원 관리자 권한 및 신청 정보:</strong> 회원 탈퇴 시 신청 정보와 비공개 사업자 증빙파일을 삭제하고 학원 관리자 권한을 해제합니다. 이미 학원에 게시된 공개 자료는 학원 정보로 유지될 수 있으며 작성자 연결정보는 제거됩니다.</li>
      <li><strong>푸시 토큰:</strong> 회원 탈퇴 또는 토큰이 더 이상 유효하지 않은 것으로 확인될 때 삭제합니다.</li>
      <li><strong>공개 학원 가격표·시간표:</strong> 공개 화면에서는 게시일로부터 기본 180일이 지난 자료를 만료 처리해 노출하지 않습니다. 만료는 공개 노출 종료를 뜻하며 데이터베이스 기록 자체가 자동 삭제되는 것은 아니고, 학원 운영자 또는 관리자가 삭제하거나 학원 정보가 삭제될 때까지 보관될 수 있습니다.</li>
      <li><strong>법령상 보존 의무가 있는 정보:</strong> 실제로 법령상 보존 의무가 발생하는 경우 해당 정보만 법정 기간 동안 분리 보관한 후 파기합니다.</li>
    </ul>
  </section>

  <section class="panel">
    <h2>4. 개인정보의 제3자 제공</h2>
    <p>발레메이트는 이용자의 개인정보를 판매하거나 임의로 제3자에게 제공하지 않습니다. 다만 다음 경우에는 서비스 제공을 위해 해당 사업자에게 필요한 정보가 전달될 수 있습니다.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>제공받는 자</th><th>제공되는 정보</th><th>목적</th></tr></thead>
      <tbody>
        <tr><td>Google 또는 Kakao</td><td>이용자가 해당 사업자를 선택해 소셜 로그인을 진행할 때 각 사업자가 로그인 과정에서 처리하는 계정·인증 정보</td><td>소셜 계정 인증</td></tr>
        <tr><td>Kakao</td><td>학원 검색어 및 주변 검색을 실행한 경우 검색 중심 좌표·반경 등 검색 요청 정보</td><td>Kakao Local 장소 검색</td></tr>
        <tr><td>Apple 또는 Google의 푸시 전송 서비스</td><td>푸시 알림 전달에 필요한 기기 토큰 및 알림 데이터</td><td>기기 푸시 알림 전달</td></tr>
      </tbody>
    </table></div>
    <p>이용자가 공개 게시판·리뷰에 작성한 내용과 공개 프로필 표시는 다른 이용자에게 공개됩니다. 공개 영역에는 전화번호, 이메일, 주소 등 사적인 정보를 작성하지 마세요.</p>
  </section>

  <section class="panel">
    <h2>5. 개인정보 처리 업무의 위탁 및 외부 서비스 이용</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>업체</th><th>위탁·이용 업무</th><th>처리 정보</th></tr></thead>
      <tbody>
        <tr><td>Supabase</td><td>회원 인증, 데이터베이스, 파일 저장, 서버 기능 운영</td><td>계정 정보, 프로필, 서비스 이용 데이터, 업로드 파일 및 서비스 요청 정보</td></tr>
        <tr><td>Expo (650 Industries, Inc.)</td><td>푸시 알림 중계</td><td>Expo 푸시 토큰 및 알림 발송에 필요한 메시지 데이터</td></tr>
        <tr><td>Google / Kakao</td><td>이용자가 선택한 소셜 로그인 인증</td><td>각 제공자가 로그인 과정에서 처리·전달하는 인증 및 프로필 정보</td></tr>
        <tr><td>Kakao</td><td>지도·장소 검색</td><td>검색어, 위치 중심 좌표 및 반경(주변 검색을 실행한 경우)</td></tr>
        <tr><td>한국교육학술정보원 교육행정정보시스템(NEIS) 및 Kakao Local API</td><td>학원 기본 정보 탐색·확인</td><td>공개 학원 등록 정보 및 장소 검색 결과. NEIS 조회에는 회원의 계정정보를 전송하지 않음</td></tr>
      </tbody>
    </table></div>
    <p>발레메이트는 위 업체의 처리 업무와 서비스 구성을 점검하고, 위탁 업무 목적 외 처리가 제한되도록 관리합니다. 위탁 업체나 업무가 변경되면 본 처리방침을 갱신합니다.</p>
  </section>

  <section class="panel">
    <h2>6. 개인정보의 국외 이전</h2>
    <p>발레메이트의 Supabase 데이터베이스·인증·스토리지의 기본 저장 리전은 <strong>${region}</strong>입니다. 다만 저장 리전이 서울이라고 해서 모든 처리 정보가 대한민국 안에서만 처리되는 것은 아닙니다.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>이전받는 사업자 및 국가·지역</th><th>이전 항목 및 목적</th><th>이전 방법·보유</th></tr></thead>
      <tbody>
        <tr><td>Supabase Pte. Ltd. 및 Supabase, Inc. (싱가포르·미국 사업자)</td><td>회원 계정·서비스 데이터는 서울 리전에서 호스팅됩니다. 운영 지원 요청 또는 보안 사고 대응 시 필요한 데이터에 대한 해외 지원 인력의 제한적 접근, 플랫폼 사용량·운영 로그 메타데이터, Storage 콘텐츠의 글로벌 CDN 전송·캐싱이 발생할 수 있습니다.</td><td>서비스 이용 중 네트워크를 통해 전송·처리. 핵심 데이터베이스·인증·스토리지 및 해당 리전 백업은 서울 리전에 저장되며, 지원 접근·플랫폼 텔레메트리·CDN은 해외에서 처리될 수 있음</td></tr>
        <tr><td>Expo (650 Industries, Inc., 미국 소재 사업자 및 푸시 전달 인프라)</td><td>Expo 푸시 토큰 및 알림 전송에 필요한 제목·내용·전달 데이터. 푸시 알림 중계 목적</td><td>푸시 발송 요청 시 네트워크로 전송. 토큰은 알림 제공을 위해 보관될 수 있고, 메시지 내용은 전송 처리에 필요한 동안 처리됨</td></tr>
        <tr><td>Google 또는 Kakao (이용자가 해당 소셜 로그인을 선택한 경우)</td><td>해당 로그인 사업자가 인증을 위해 처리하는 계정 및 인증 정보</td><td>이용자가 소셜 로그인을 실행할 때 해당 사업자의 인증 절차를 통해 전송. 보유기간과 처리 위치는 각 사업자의 정책에 따름</td></tr>
      </tbody>
    </table></div>
    <p>Supabase의 핵심 데이터 저장 리전은 서울로 설정되어 있으나, 운영 지원 인력의 해외 접근, 플랫폼 로그·텔레메트리의 해외 처리, Storage 콘텐츠의 글로벌 CDN 전달이 별도로 발생할 수 있습니다. Expo는 푸시 토큰을 처리하고 알림 내용을 Apple·Google 푸시 서비스로 전달하며, Expo는 전달 후 알림 내용을 장기간 저장하지 않는다고 안내합니다. Google·Kakao 소셜 로그인 및 Apple·Google 푸시 전송의 처리 위치는 각 사업자의 정책을 따릅니다. <a href="https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq" target="_blank" rel="noopener noreferrer">Supabase 데이터 저장 및 이전 안내</a>, <a href="https://docs.expo.dev/push-notifications/faq/" target="_blank" rel="noopener noreferrer">Expo 푸시 알림 개인정보 안내</a>를 참고할 수 있습니다.</p>
  </section>

  <section class="panel">
    <h2>7. 개인정보의 파기 절차 및 방법</h2>
    <p>보유기간이 끝나거나 처리 목적이 달성되어 개인정보가 불필요해지면 지체 없이 파기합니다.</p>
    <ul>
      <li>전자적 파일과 데이터베이스 정보는 복구할 수 없도록 삭제합니다. 회원 탈퇴 시 회원 계정과 연결된 개인정보 및 파일은 운영 데이터베이스와 저장소에서 삭제합니다.</li>
      <li>출력물 등 종이 문서가 있는 경우 분쇄 또는 소각 등으로 파기합니다.</li>
      <li>회원 탈퇴 시 프로필, 즐겨찾기, 알림 설정, 리뷰, 게시글·댓글, 북마크, 신고·차단 및 커뮤니티 사진, 푸시 토큰, 학원 관리 신청·비공개 증빙서류는 삭제 절차에 따라 삭제됩니다. 학원 관리자 권한은 해제되고 해당 회원이 작성한 학원 공지사항도 삭제됩니다. 공개 학원 정보·가격표·시간표와 학원에 게시된 자료는 회원 계정과 분리해 유지될 수 있으며, 작성자 식별 연결정보는 제거됩니다.</li>
    </ul>
  </section>

  <section class="panel">
    <h2>8. 정보주체의 권리와 행사 방법</h2>
    <p>이용자는 언제든지 본인 개인정보의 열람, 정정, 삭제, 처리정지 및 동의 철회를 요청할 수 있습니다.</p>
    <ul>
      <li>회원 탈퇴: 앱의 내 계정 화면에서 회원 탈퇴를 실행할 수 있습니다. 발레메이트 앱 계정은 삭제되지만, Google 또는 Kakao 자체 계정은 각 제공자에서 별도로 관리해야 합니다.</li>
      <li>개인정보 문의 및 권리 행사: 아래 이메일로 계정 식별에 필요한 정보와 요청 내용을 보내 주세요.</li>
      <li>위치 정보: 기기의 앱 권한 설정에서 위치 접근을 언제든지 허용 또는 거부할 수 있습니다. 거부하면 주변 학원 검색의 일부 기능이 제한될 수 있습니다.</li>
      <li>푸시 알림: 기기 설정에서 발레메이트의 알림 권한을 끌 수 있습니다.</li>
    </ul>
    <p><a href="https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/delete-account">외부 계정 삭제 요청 안내 페이지</a>에서도 계정 삭제 요청 방법을 확인할 수 있습니다.</p>
  </section>

  <section class="panel">
    <h2>9. 개인정보의 안전성 확보 조치</h2>
    <p>발레메이트는 개인정보 보호를 위해 다음 조치를 적용합니다.</p>
    <ul>
      <li>인증 및 권한에 따른 데이터 접근 통제와 Row Level Security(RLS) 적용</li>
      <li>관리자·학원 운영자 권한의 분리 및 필요한 범위 내 접근 허용</li>
      <li>서버 비밀키의 앱 코드 외부 보관 및 서버 측 처리</li>
      <li>HTTPS 등 암호화된 통신을 통한 서비스 데이터 전송</li>
      <li>신고·차단·작성 제한 등 커뮤니티 악용 방지 기능 운영</li>
    </ul>
  </section>

  <section class="panel">
    <h2>10. 자동화된 결정 및 행태정보</h2>
    <p>발레메이트는 이용자에게 법적 효과 또는 이에 준하는 중대한 영향을 미치는 자동화된 결정을 현재 서비스의 주요 기능으로 운영하지 않습니다. 광고 목적의 행태정보 추적이나 맞춤형 광고를 위해 별도의 광고 식별자를 수집하는 기능도 현재 앱 코드에서 확인되지 않았습니다.</p>
  </section>

  <section class="panel">
    <h2>11. 운영자 및 개인정보 문의처</h2>
    <p>개인정보처리자는 이동규이며, 개인정보 처리와 관련한 문의, 불만 처리 및 피해 구제 요청은 아래 연락처로 접수할 수 있습니다.</p>
    <ul>
      <li>개인정보처리자: ${operator}</li>
      <li>이메일: ${contactHtml}</li>
      
      <li>문의 내용: 개인정보 열람·정정·삭제 요청, 계정 삭제, 개인정보 관련 불만 및 피해 구제</li>
    </ul>
    <p>개인정보 침해에 대한 신고나 상담이 필요한 경우 개인정보침해신고센터(국번 없이 118) 등 관계 기관에 문의할 수 있습니다.</p>
  </section>

  <section class="panel">
    <h2>12. 처리방침 변경</h2>
    <p>이 개인정보 처리방침은 2026년 11월 25일부터 적용됩니다. 처리 항목, 이용 목적, 외부 서비스 또는 법령이 변경되는 경우 변경 내용을 앱 공지 또는 본 페이지를 통해 안내합니다.</p>
    <p class="small">본 처리방침은 발레메이트 앱의 현재 코드와 확인 가능한 Supabase 설정을 기준으로 작성되었습니다. 외부 서비스의 계약·세부 보관기간 및 운영 설정이 변경되면 그에 맞춰 갱신합니다.</p>
  </section>
  <footer>© 2026 Balletmate · 개인정보 처리방침</footer>
</main>
</body>
</html>`;

  const encodedHtml = encodeNonAscii(html);
  return new Response(req.method === "HEAD" ? null : encodedHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
});
