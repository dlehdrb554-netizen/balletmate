const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] || char));

Deno.serve((req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const operator = htmlEscape(Deno.env.get("PRIVACY_POLICY_OPERATOR_NAME") || "Balletmate 운영팀");
  const contactRaw = Deno.env.get("ACCOUNT_DELETION_CONTACT_EMAIL") || "";
  const contact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactRaw) ? contactRaw : "";
  const region = htmlEscape(Deno.env.get("PRIVACY_POLICY_DATA_REGION") || "[Supabase 프로젝트 리전 확인 후 설정 필요]");
  const contactHtml = contact
    ? `<a href="mailto:${htmlEscape(contact)}">${htmlEscape(contact)}</a>`
    : "<strong>개인정보 문의 이메일 설정 필요</strong>";
  const rightsHtml = contact
    ? `<a href="mailto:${htmlEscape(contact)}?subject=Balletmate%20%EC%82%AC%EC%A7%84%20%EC%A0%80%EC%9E%91%EA%B6%8C%2F%EC%82%AD%EC%A0%9C%20%EC%9A%94%EC%B2%AD">사진 저작권·삭제 요청</a>`
    : "<strong>사진 권리 요청 이메일 설정 필요</strong>";
  const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balletmate 개인정보처리방침</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:36px auto;padding:0 20px;color:#252238;line-height:1.75}h1{font-size:28px}h2{font-size:18px;margin-top:28px}.notice{background:#fff4e5;color:#8a4b08;padding:14px;border-radius:12px}li{margin:6px 0}a{color:#653bb7}</style></head><body><h1>Balletmate 개인정보처리방침</h1><p>시행일: [출시일 확정 후 기재] · 운영자: ${operator}</p><div class="notice">출시 전 확인 항목: 운영자 법적 표기명, 개인정보 문의 이메일, Supabase 데이터 리전 및 시행일을 실제 운영 설정에 맞춰 확정해야 합니다. 설정이 완료되지 않은 상태로 스토어에 제출하지 마세요.</div>
<h2>1. 처리하는 개인정보</h2><ul><li>계정: Supabase 사용자 식별자, 로그인 제공자 식별정보 및 제공자가 전달하는 이메일(제공되는 경우)</li><li>프로필: 닉네임·표시명 및 계정 설정 정보</li><li>서비스 이용: 즐겨찾기, 커뮤니티 게시글·댓글·신고·차단 및 이용규칙 동의 기록</li><li>학원 관리: 원장 권한 신청 정보, 사업자 확인 서류, 학원 공지 및 사용자가 등록한 사진</li><li>위치·사진 권한: 주변 학원 탐색을 위해 계산한 지도 범위 좌표가 Supabase 학원 조회 요청에 포함됩니다. 앱 데이터베이스에 GPS 좌표를 별도 저장하는 코드는 확인되지 않았습니다. 사용자가 선택해 올린 학원 사진은 공개 갤러리에 표시될 수 있습니다.</li></ul>
<h2>2. 처리 목적</h2><p>회원 인증, 즐겨찾기 동기화, 주변 학원 탐색, 학원 정보 관리, 커뮤니티 운영, 신고 처리 및 서비스 보안에 이용합니다.</p>
<h2>3. 처리 위탁 및 외부 서비스</h2><ul><li>Supabase: 인증, 데이터베이스 및 파일 저장 인프라 (프로젝트 리전: ${region}); 지도 범위 좌표와 서비스 계정 데이터가 요청 처리에 사용됩니다.</li><li>Google 및 카카오: 이용자가 선택한 소셜 로그인 인증</li><li>Kakao: 지도 및 장소 검색 기능</li><li>Naver 등 외부 공개 웹사이트: 등록된 공식 블로그 및 학원 공식 홈페이지의 공개 자료 확인. 권리 확인되지 않은 제3자 블로그 게시물 본문은 자동 수집하지 않습니다.</li><li>Cloudflare Workers AI: 공개 학원 사진 후보의 발레 관련성 분류를 위해 이미지 데이터가 처리될 수 있습니다. OCR·문자 판독은 수행하지 않으며, AI 분류만으로 사진을 공개하지 않습니다.</li></ul><p>각 서비스 제공자의 개인정보 처리 및 국외 이전 조건은 해당 제공자의 정책과 실제 프로젝트 리전에 따릅니다.</p>
<h2>4. 보유 및 파기</h2><p>회원 탈퇴 시 계정 프로필, 즐겨찾기, 회원 작성 커뮤니티 콘텐츠와 계정에 연결된 신청 정보를 삭제합니다. 원장 권한을 해제하고 비공개 사업자 서류 및 작성자 계정에 종속된 공지사항도 삭제합니다. 학원 운영 정보와 학원 사진처럼 학원 자체에 관한 공개 자료는 회원 계정과 분리하여 유지될 수 있습니다.</p>
<h2>5. 이용자의 권리 및 계정 삭제</h2><p>앱의 내 계정 화면에서 회원 탈퇴를 실행할 수 있으며, <a href="https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/delete-account">외부 계정 삭제 요청 페이지</a>에서도 삭제를 요청할 수 있습니다. 삭제 요청은 본인 확인 후 처리합니다.</p>
<h2>6. 안전조치</h2><p>Supabase Row Level Security, 인증된 서버 처리, 비밀키의 서버 보관 등 접근 통제 조치를 적용합니다.</p>
<h2>7. 개인정보 문의 및 사진 권리 요청</h2><p>개인정보 처리자: ${operator}<br>문의 이메일: ${contactHtml}<br>학원 사진 저작권·삭제 요청: ${rightsHtml}</p><p>사진 삭제 요청에는 해당 사진 URL, 원본 출처, 권리자 또는 대리인 정보, 요청 사유를 포함해 주세요. 앱 내 학원 정보 제보에서도 '저작권/사진 삭제 요청'을 접수할 수 있습니다.</p></body></html>`;
  return new Response(req.method === "HEAD" ? null : body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
});
